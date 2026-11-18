// The level of detail of a trace, i.e. the points of a trace that we need to draw so that it looks the same as if all
// of its points were drawn (see gpuPlotRenderer.ts).
// Note #1: a trace may have millions of points, i.e. many more than there are pixel columns in a plot. However, if the
//          X values of a trace are sorted, then the points that fall within a pixel column get drawn as a vertical line
//          that goes from their minimum to their maximum Y value, and that is connected to the previous and next pixel
//          columns through their first and last points. So, rather than draw all the points of a pixel column, we only
//          need to draw (in order) its first point, the points with its minimum and maximum Y values, and its last
//          point (this is known as M4 aggregation). This means that drawing a trace costs O(number of pixel columns)
//          rather than O(number of points). (Our columns don't have to be pixel columns, e.g. our GPU plot renderer
//          uses several columns per pixel, see Note #7 of gpuPlotRenderer.ts.)
// Note #2: to find the points with the minimum and maximum Y values of a range of points quickly, we keep, for each
//          block of BLOCK_SIZE points, the index of its point with the minimum (and maximum) Y value, and whether it
//          has a non-finite Y value (i.e. a gap). We then do the same for each block of BLOCK_SIZE blocks, and so on.
//          This means that finding those points costs O(BLOCK_SIZE * log(number of points)) rather than O(number of
//          points).
// Note #3: like the rest of our data processing (see traceValues.ts), our blocks are kept up to date incrementally,
//          i.e. if only the last point onwards of a trace may have changed, then we only update the blocks that cover
//          those points.
// Note #4: a range of points that has a gap cannot be drawn as described in Note #1 (since the gap would not be shown),
//          so selectPoints() fails if the visible points of a trace have a gap, in which case all of them have to be
//          drawn.
// Note #5: we keep track of the points that we last selected, and of the first point that may have changed since then.
//          So, if a trace gets drawn for the same X range and number of columns as before (e.g., while a simulation is
//          running, with a fixed X range), then we only select the points of the columns from the one that contains
//          the first point that may have changed, i.e. drawing a few more points costs O(number of new points) rather
//          than O(number of columns).
// Note #6: a level of detail may be shared (e.g., by the two renderers of a plot), so each selection has a number, so
//          that a consumer can tell whether a selection directly follows the one it last used (in which case only its
//          points from firstChanged onwards may differ from it) or not (in which case all of them may differ).

const BLOCK_SIZE = 16;

export const MIN_POINTS_PER_COLUMN = 8; // Minimum number of (visible) points per column for us to be worth using.

interface ILevel {
  min: Int32Array; // Index of the point with the minimum (finite) Y value of a block, or -1 if there is none.
  max: Int32Array; // Index of the point with the maximum (finite) Y value of a block, or -1 if there is none.
  gap: Uint8Array; // Whether a block has a non-finite Y value.
}

export interface ISelection {
  indices: Int32Array; // Index of our selected points.
  nbOfPoints: number; // Number of our selected points.
  firstChanged: number; // Number of leading selected points that are the same as in our previous selection.
  xMin: number; // Minimum X value of the X range for which our points were selected.
  xMax: number; // Maximum X value of the X range for which our points were selected.
  nbOfColumns: number; // Number of columns into which our X range was split.
  start: number; // Index of the first point (included) of the range of points from which our points were selected.
  end: number; // Index of the last point (excluded) of the range of points from which our points were selected.
  validCount: number; // Number of leading points that haven't changed since our points were selected.
  number: number; // Number of our selection, i.e. of the selections made by our level of detail (see Note #6 above).
}

export interface ILevelOfDetail {
  count: number; // Number of points that we have processed.
  sortedLength: number; // Number of leading points whose X values are finite and sorted in increasing order.
  levels: ILevel[]; // Our blocks of BLOCK_SIZE points, of BLOCK_SIZE^2 points, etc.
  selection: ISelection | undefined; // Our last selection of points (see selectPoints()).
  nbOfSelections: number; // Number of selections that we have made (see Note #6 above).
}

export const create = (): ILevelOfDetail => {
  return { count: 0, sortedLength: 0, levels: [], selection: undefined, nbOfSelections: 0 };
};

export const memoryUsage = (lod: ILevelOfDetail): number => {
  // Return the number of bytes used by the given level of detail, i.e. by its blocks and its selection.

  let res = lod.selection?.indices.byteLength ?? 0;

  for (const level of lod.levels) {
    res += level.min.byteLength + level.max.byteLength + level.gap.byteLength;
  }

  return res;
};

export const invalidate = (lod: ILevelOfDetail, from: number): void => {
  // Invalidate the given level of detail from the given point onwards (i.e. those points may have changed).

  lod.count = Math.min(lod.count, from);
  lod.sortedLength = Math.min(lod.sortedLength, from);

  if (lod.selection) {
    lod.selection.validCount = Math.min(lod.selection.validCount, from);
  }
};

const levelWithCapacity = (lod: ILevelOfDetail, index: number, capacity: number): ILevel => {
  // Return the given level, making sure that it can hold the given number of blocks.

  let level = lod.levels[index];

  if (!level || level.min.length < capacity) {
    const newCapacity = Math.max(capacity, 2 * (level?.min.length ?? 0), 64);
    const newLevel = {
      min: new Int32Array(newCapacity),
      max: new Int32Array(newCapacity),
      gap: new Uint8Array(newCapacity)
    };

    if (level) {
      newLevel.min.set(level.min);
      newLevel.max.set(level.max);
      newLevel.gap.set(level.gap);
    }

    level = newLevel;
    lod.levels[index] = level;
  }

  return level;
};

export const update = (lod: ILevelOfDetail, xValues: Float64Array, yValues: Float64Array, count: number): void => {
  // Process the given points from the first one that we haven't processed (see invalidate()).
  // Note: like convertPoints() in gpuPlotRenderer.ts, our loops only use local variables, so that they are fast.

  const from = lod.count;

  if (from >= count) {
    return;
  }

  // Determine how many of our leading points have finite X values that are sorted.
  // Note: we use x - x === 0 to check whether x is finite since it is faster than Number.isFinite().

  let sortedLength = lod.sortedLength;

  if (sortedLength === from) {
    let previous = sortedLength > 0 ? (xValues[sortedLength - 1] as number) : Number.NEGATIVE_INFINITY;

    while (sortedLength < count) {
      const x = xValues[sortedLength] as number;

      if (x - x !== 0 || x < previous) {
        break;
      }

      previous = x;
      ++sortedLength;
    }

    lod.sortedLength = sortedLength;
  }

  // Update our blocks of points.

  let firstBlock = Math.floor(from / BLOCK_SIZE);
  let nbOfBlocks = Math.ceil(count / BLOCK_SIZE);

  if (count >= BLOCK_SIZE) {
    const { min, max, gap } = levelWithCapacity(lod, 0, nbOfBlocks);

    for (let block = firstBlock; block < nbOfBlocks; ++block) {
      const end = Math.min(count, (block + 1) * BLOCK_SIZE);
      let minIndex = -1;
      let maxIndex = -1;
      let minValue = Number.POSITIVE_INFINITY;
      let maxValue = Number.NEGATIVE_INFINITY;
      let hasGap = 0;

      for (let i = block * BLOCK_SIZE; i < end; ++i) {
        const y = yValues[i] as number;

        if (y - y === 0) {
          if (y < minValue) {
            minValue = y;
            minIndex = i;
          }

          if (y > maxValue) {
            maxValue = y;
            maxIndex = i;
          }
        } else {
          hasGap = 1;
        }
      }

      min[block] = minIndex;
      max[block] = maxIndex;
      gap[block] = hasGap;
    }
  }

  // Update our blocks of blocks, and so on.

  for (let levelIndex = 1, blockSize = BLOCK_SIZE * BLOCK_SIZE; count >= blockSize; ++levelIndex) {
    const children = lod.levels[levelIndex - 1] as ILevel;
    const nbOfChildren = nbOfBlocks;

    firstBlock = Math.floor(from / blockSize);
    nbOfBlocks = Math.ceil(count / blockSize);

    const { min, max, gap } = levelWithCapacity(lod, levelIndex, nbOfBlocks);

    for (let block = firstBlock; block < nbOfBlocks; ++block) {
      const end = Math.min(nbOfChildren, (block + 1) * BLOCK_SIZE);
      let minIndex = -1;
      let maxIndex = -1;
      let hasGap = 0;

      for (let child = block * BLOCK_SIZE; child < end; ++child) {
        const childMin = children.min[child] as number;
        const childMax = children.max[child] as number;

        if (childMin >= 0) {
          if (minIndex < 0 || (yValues[childMin] as number) < (yValues[minIndex] as number)) {
            minIndex = childMin;
          }

          if (maxIndex < 0 || (yValues[childMax] as number) > (yValues[maxIndex] as number)) {
            maxIndex = childMax;
          }
        }

        hasGap |= children.gap[child] as number;
      }

      min[block] = minIndex;
      max[block] = maxIndex;
      gap[block] = hasGap;
    }

    blockSize *= BLOCK_SIZE;
  }

  lod.count = count;
};

// The result of a query (see query()), i.e. the index of the point with the minimum (and maximum) finite Y value of a
// range of points (or -1 if there is none), their Y value, and whether that range has a gap.
// Note: our query functions only use local variables (and update this result once per call), so that they are fast
//       (see update()).

const QUERY_MIN_INDEX = 0;
const QUERY_MAX_INDEX = 1;
const QUERY_MIN_VALUE = 2;
const QUERY_MAX_VALUE = 3;
const QUERY_HAS_GAP = 4;

const queryResult = new Float64Array(5);

const resetQueryResult = (): void => {
  queryResult[QUERY_MIN_INDEX] = -1;
  queryResult[QUERY_MAX_INDEX] = -1;
  queryResult[QUERY_MIN_VALUE] = Number.POSITIVE_INFINITY;
  queryResult[QUERY_MAX_VALUE] = Number.NEGATIVE_INFINITY;
  queryResult[QUERY_HAS_GAP] = 0;
};

const queryPoints = (yValues: Float64Array, start: number, end: number): void => {
  // Take the given points into account in our query result.

  if (start >= end) {
    return;
  }

  let minIndex = queryResult[QUERY_MIN_INDEX] as number;
  let maxIndex = queryResult[QUERY_MAX_INDEX] as number;
  let minValue = queryResult[QUERY_MIN_VALUE] as number;
  let maxValue = queryResult[QUERY_MAX_VALUE] as number;
  let hasGap = queryResult[QUERY_HAS_GAP] as number;

  for (let i = start; i < end; ++i) {
    const y = yValues[i] as number;

    if (y - y === 0) {
      if (y < minValue) {
        minValue = y;
        minIndex = i;
      }

      if (y > maxValue) {
        maxValue = y;
        maxIndex = i;
      }
    } else {
      hasGap = 1;
    }
  }

  queryResult[QUERY_MIN_INDEX] = minIndex;
  queryResult[QUERY_MAX_INDEX] = maxIndex;
  queryResult[QUERY_MIN_VALUE] = minValue;
  queryResult[QUERY_MAX_VALUE] = maxValue;
  queryResult[QUERY_HAS_GAP] = hasGap;
};

const queryBlocks = (level: ILevel, yValues: Float64Array, start: number, end: number): void => {
  // Take the given blocks of the given level into account in our query result.

  if (start >= end) {
    return;
  }

  let minIndex = queryResult[QUERY_MIN_INDEX] as number;
  let maxIndex = queryResult[QUERY_MAX_INDEX] as number;
  let minValue = queryResult[QUERY_MIN_VALUE] as number;
  let maxValue = queryResult[QUERY_MAX_VALUE] as number;
  let hasGap = queryResult[QUERY_HAS_GAP] as number;
  const { min, max, gap } = level;

  for (let block = start; block < end; ++block) {
    const blockMin = min[block] as number;

    if (blockMin >= 0) {
      const blockMax = max[block] as number;
      const blockMinValue = yValues[blockMin] as number;
      const blockMaxValue = yValues[blockMax] as number;

      if (blockMinValue < minValue) {
        minValue = blockMinValue;
        minIndex = blockMin;
      }

      if (blockMaxValue > maxValue) {
        maxValue = blockMaxValue;
        maxIndex = blockMax;
      }
    }

    hasGap |= gap[block] as number;
  }

  queryResult[QUERY_MIN_INDEX] = minIndex;
  queryResult[QUERY_MAX_INDEX] = maxIndex;
  queryResult[QUERY_MIN_VALUE] = minValue;
  queryResult[QUERY_MAX_VALUE] = maxValue;
  queryResult[QUERY_HAS_GAP] = hasGap;
};

const query = (lod: ILevelOfDetail, yValues: Float64Array, start: number, end: number): void => {
  // Query the given range of points, i.e. from the given start (included) to the given end (excluded), going through
  // the raw points and then the blocks (of the different levels) that cover our range.

  resetQueryResult();

  let low = start;
  let high = end;

  for (let levelIndex = -1; low < high; ++levelIndex) {
    const level = levelIndex >= 0 ? (lod.levels[levelIndex] as ILevel) : undefined;

    // If there is no next level, then process our remaining points/blocks directly.

    if (!lod.levels[levelIndex + 1]) {
      if (level) {
        queryBlocks(level, yValues, low, high);
      } else {
        queryPoints(yValues, low, high);
      }

      break;
    }

    // Process our points/blocks up to the first block (of the next level) that is fully within our range, and from the
    // last one that is fully within our range, and move on to the next level.

    const alignedLow = Math.min(high, Math.ceil(low / BLOCK_SIZE) * BLOCK_SIZE);
    const alignedHigh = Math.max(alignedLow, Math.floor(high / BLOCK_SIZE) * BLOCK_SIZE);

    if (level) {
      queryBlocks(level, yValues, low, alignedLow);
      queryBlocks(level, yValues, alignedHigh, high);
    } else {
      queryPoints(yValues, low, alignedLow);
      queryPoints(yValues, alignedHigh, high);
    }

    low = alignedLow / BLOCK_SIZE;
    high = alignedHigh / BLOCK_SIZE;
  }
};

const lowerBound = (values: Float64Array, start: number, end: number, value: number): number => {
  // Return the index of the first of the given (sorted) values, between the given start and end, that is not less than
  // the given value (or the given end if there is none).

  let low = start;
  let high = end;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((values[middle] as number) < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

const gallopingLowerBound = (values: Float64Array, start: number, end: number, value: number): number => {
  // Same as lowerBound(), but for a value that is expected to be close to the given start (e.g., the next column
  // boundary in selectPoints()), in which case it is faster.

  let low = start;
  let high = start;
  let step = 1;

  while (high < end && (values[high] as number) < value) {
    low = high + 1;
    high += step;
    step *= 2;
  }

  return lowerBound(values, low, Math.min(high, end), value);
};

const upperBound = (values: Float64Array, start: number, end: number, value: number): number => {
  // Return the index of the first of the given (sorted) values, between the given start and end, that is greater than
  // the given value (or the given end if there is none).

  let low = start;
  let high = end;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((values[middle] as number) <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

export const visibleRange = (
  xValues: Float64Array,
  count: number,
  xMin: number,
  xMax: number
): [start: number, end: number] => {
  // Return the range of the given points (whose X values must be sorted) that we need to draw for the given X range,
  // i.e. the points within that range, as well as the points just before and after it (so that our trace goes all the
  // way to the edges of our plotting area).

  const start = lowerBound(xValues, 0, count, xMin);
  const end = upperBound(xValues, start, count, xMax);

  return [Math.max(0, start - 1), Math.min(count, end + 1)];
};

const maxNbOfSelectedPoints = (nbOfColumns: number): number => {
  // Return the maximum number of points that selectPoints() may select for the given number of columns.

  return 4 * (nbOfColumns + 2);
};

const selectRangePoints = (
  lod: ILevelOfDetail,
  yValues: Float64Array,
  start: number,
  end: number,
  output: Int32Array,
  nbOfPoints: number
): number => {
  // Select the first point of the given range, its points with the minimum and maximum Y values (in order), and its
  // last point, add their index to the given output (which already has the given number of points), and return the
  // new number of points.

  let res = nbOfPoints;

  if (end - start <= 4) {
    for (let i = start; i < end; ++i) {
      output[res++] = i;
    }

    return res;
  }

  query(lod, yValues, start, end);

  const last = end - 1;
  const minIndex = queryResult[QUERY_MIN_INDEX] as number;
  const maxIndex = queryResult[QUERY_MAX_INDEX] as number;
  const firstExtremum = Math.min(minIndex, maxIndex);
  const secondExtremum = Math.max(minIndex, maxIndex);

  output[res++] = start;

  if (firstExtremum > start && firstExtremum < last) {
    output[res++] = firstExtremum;
  }

  if (secondExtremum > start && secondExtremum < last && secondExtremum !== firstExtremum) {
    output[res++] = secondExtremum;
  }

  output[res++] = last;

  return res;
};

export const selectPoints = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  xMin: number,
  xMax: number,
  nbOfColumns: number
): ISelection | undefined => {
  // Select the points, in the given range (see visibleRange()), that we need to draw for the given X range split into
  // the given number of columns (see Note #1 above), or return undefined if our range has a gap (see Note #4).
  // Note: our level of detail must be up to date (see update()).

  query(lod, yValues, start, end);

  if (queryResult[QUERY_HAS_GAP]) {
    lod.selection = undefined;

    return undefined;
  }

  // Our points are selected range by range, i.e. iteration k selects the points of [b(k - 1), b(k)), where b(-1) is
  // our start, b(k) is the first point whose X value is not less than boundary(k) (for 0 <= k <= nbOfColumns), and
  // b(nbOfColumns + 1) is our end.

  const columnWidth = (xMax - xMin) / nbOfColumns;
  const boundary = (k: number): number => (k === nbOfColumns ? xMax : xMin + k * columnWidth);
  let selection = lod.selection;
  let iteration = 0;
  let rangeStart = start;
  let nbOfPoints = 0;

  // Check whether we can reuse (some of) our previous selection (see Note #5 above), i.e. resume from the range that
  // contains the first point that may have changed (or the last point that we previously had).

  if (
    selection &&
    selection.xMin === xMin &&
    selection.xMax === xMax &&
    selection.nbOfColumns === nbOfColumns &&
    selection.start === start
  ) {
    const firstChangedPoint = Math.min(selection.validCount, selection.end) - 1;

    if (firstChangedPoint >= start) {
      // Determine the last boundary that is not greater than the X value of our first changed point, if any.

      const x = xValues[firstChangedPoint] as number;
      let k = Math.max(-1, Math.min(nbOfColumns, Math.floor((x - xMin) / columnWidth)));

      while (k < nbOfColumns && boundary(k + 1) <= x) {
        ++k;
      }

      while (k >= 0 && boundary(k) > x) {
        --k;
      }

      if (k >= 0) {
        iteration = k + 1;
        rangeStart = lowerBound(xValues, start, end, boundary(k));

        // Keep our previously selected points that come before our range start.

        let low = 0;
        let high = selection.nbOfPoints;

        while (low < high) {
          const middle = (low + high) >>> 1;

          if ((selection.indices[middle] as number) < rangeStart) {
            low = middle + 1;
          } else {
            high = middle;
          }
        }

        nbOfPoints = low;
      }
    }
  }

  // Make sure that our selection exists and is big enough.

  const capacity = maxNbOfSelectedPoints(nbOfColumns);

  if (!selection || selection.indices.length < capacity) {
    selection = {
      indices: new Int32Array(capacity),
      nbOfPoints: 0,
      firstChanged: 0,
      xMin,
      xMax,
      nbOfColumns,
      start,
      end,
      validCount: 0,
      number: 0
    };

    iteration = 0;
    rangeStart = start;
    nbOfPoints = 0;
  }

  // Select our points from our range start.

  const indices = selection.indices;

  selection.firstChanged = nbOfPoints;

  for (; iteration <= nbOfColumns + 1; ++iteration) {
    const rangeEnd =
      iteration > nbOfColumns
        ? end
        : gallopingLowerBound(
            xValues,
            rangeStart,
            end,
            iteration === nbOfColumns ? xMax : xMin + iteration * columnWidth
          );

    nbOfPoints = selectRangePoints(lod, yValues, rangeStart, rangeEnd, indices, nbOfPoints);
    rangeStart = rangeEnd;
  }

  selection.nbOfPoints = nbOfPoints;
  selection.xMin = xMin;
  selection.xMax = xMax;
  selection.nbOfColumns = nbOfColumns;
  selection.start = start;
  selection.end = end;
  selection.validCount = Number.POSITIVE_INFINITY;
  selection.number = ++lod.nbOfSelections;

  lod.selection = selection;

  return selection;
};
