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
//          block of BLOCK_SIZE points, the index of its finite point with the minimum (and maximum) Y value, and
//          whether it has a gap (i.e. a point with a non-finite X or Y value). We then do the same for each block of
//          BLOCK_SIZE blocks, and so on.
//          This means that finding those points costs O(BLOCK_SIZE * log(number of points)) rather than O(number of
//          points).
// Note #3: like the rest of our data processing (see traceValues.ts), our blocks are kept up to date incrementally,
//          i.e. if only the last point onwards of a trace may have changed, then we only update the blocks that cover
//          those points.
// Note #4: a range of points that has a gap cannot be drawn as described in Note #1 (since the gap would not be shown).
//          So, for a range of points that has gaps, we select the first, minimum, maximum, and last points of each run
//          of finite points, as well as the first point of each gap (so that the gap gets drawn as such). To find our
//          gaps quickly, we skip the blocks that have no gap (when looking for the next gap) or no finite point (when
//          looking for the next finite point). A range of points with many gaps may therefore have many selected points
//          (e.g., all of its points if every other point is a gap), so our selection grows if needed.
// Note #5: a path (e.g., our Canvas 2D path, see linearPath() in PlotWidget.vue) starts from the first point after a
//          gap and only then starts drawing the points of a column. So, for a run of finite points that follows a gap,
//          we select its first point and then the first, minimum, maximum, and last points of the rest of the run, so
//          that what gets drawn is exactly the same as if all of its points were drawn.
// Note #6: we keep track of the points that we last selected, and of the first point that may have changed since then.
//          So, if a trace gets drawn for the same X range and number of columns as before (e.g., while a simulation is
//          running, with a fixed X range), then we only select the points of the columns from the one that contains
//          the first point that may have changed, i.e. drawing a few more points costs O(number of new points) rather
//          than O(number of columns).
// Note #7: a level of detail may be shared (e.g., by the two renderers of a plot), so each selection has a number, so
//          that a consumer can tell whether a selection directly follows the one it last used (in which case only its
//          points from firstChanged onwards may differ from it) or not (in which case all of them may differ).
// Note #8: a gap may have a non-finite X value (e.g., a logarithmic X axis and a non-positive X value), or a finite X
//          value that is anywhere (since it doesn't get drawn), so only the X values of our finite points need to be
//          sorted. This means that, when looking for the first point that is in a given column, we look at the first
//          finite point from a given point, skipping our gaps as described in Note #4 (i.e. the gaps between two finite
//          points belong to the column of the second one).

const BLOCK_SIZE = 16;

export const MIN_POINTS_PER_COLUMN = 8; // Minimum number of (visible) points per column for us to be worth using.

interface ILevel {
  min: Int32Array; // Index of the finite point with the minimum Y value of a block, or -1 if there is none.
  max: Int32Array; // Index of the finite point with the maximum Y value of a block, or -1 if there is none.
  gap: Uint8Array; // Whether a block has a gap, i.e. a point with a non-finite X or Y value.
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
  number: number; // Number of our selection, i.e. of the selections made by our level of detail (see Note #7 above).
}

export interface ILevelOfDetail {
  count: number; // Number of points that we have processed.
  sortedLength: number; // Number of leading points whose finite points have sorted X values (see Note #8 above).
  levels: ILevel[]; // Our blocks of BLOCK_SIZE points, of BLOCK_SIZE^2 points, etc.
  selection: ISelection | undefined; // Our last selection of points (see selectPoints()).
  nbOfSelections: number; // Number of selections that we have made (see Note #7 above).
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

const isGap = (xValues: Float64Array, yValues: Float64Array, index: number): boolean => {
  // Return whether the given point is a gap, i.e. whether its X or Y value is not finite.
  // Note: we use x - x !== 0 to check whether x is not finite since it is faster than !Number.isFinite().

  const x = xValues[index] as number;
  const y = yValues[index] as number;

  return x - x !== 0 || y - y !== 0;
};

const previousFinitePoint = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  from: number
): number => {
  // Return the index of the last finite point, up to the given point (included), or -1 if there is none. To do so, we
  // skip, backwards, the biggest blocks that we can, i.e. those that have no finite point (see Note #4 above).
  // Note: the blocks that we skip end at or before the given point, so they are up to date.

  const levels = lod.levels;
  let i = from;

  while (i >= 0) {
    let skipped = false;

    for (let levelIndex = (i + 1) % BLOCK_SIZE === 0 ? levels.length - 1 : -1; levelIndex >= 0; --levelIndex) {
      const blockSize = BLOCK_SIZE ** (levelIndex + 1);

      if ((i + 1) % blockSize === 0 && (levels[levelIndex] as ILevel).min[(i + 1) / blockSize - 1] === -1) {
        i -= blockSize;
        skipped = true;

        break;
      }
    }

    if (!skipped) {
      if (!isGap(xValues, yValues, i)) {
        return i;
      }

      --i;
    }
  }

  return -1;
};

export const update = (lod: ILevelOfDetail, xValues: Float64Array, yValues: Float64Array, count: number): void => {
  // Process the given points from the first one that we haven't processed (see invalidate()).
  // Note #1: like convertPoints() in gpuPlotRenderer.ts, our loops only use local variables, so that they are fast.
  // Note #2: we use x - x === 0 to check whether x is finite since it is faster than Number.isFinite().

  const from = lod.count;

  if (from >= count) {
    return;
  }

  // Update our blocks of points.

  let firstBlock = Math.floor(from / BLOCK_SIZE);
  let nbOfBlocks = Math.ceil(count / BLOCK_SIZE);

  let nbOfLevels = 0;

  if (count >= BLOCK_SIZE) {
    const { min, max, gap } = levelWithCapacity(lod, 0, nbOfBlocks);

    nbOfLevels = 1;

    for (let block = firstBlock; block < nbOfBlocks; ++block) {
      const end = Math.min(count, (block + 1) * BLOCK_SIZE);
      let minIndex = -1;
      let maxIndex = -1;
      let minValue = Number.POSITIVE_INFINITY;
      let maxValue = Number.NEGATIVE_INFINITY;
      let hasGap = 0;

      for (let i = block * BLOCK_SIZE; i < end; ++i) {
        const x = xValues[i] as number;
        const y = yValues[i] as number;

        if (x - x === 0 && y - y === 0) {
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
    nbOfLevels = levelIndex + 1;
  }

  // Drop the levels that we may have had for more points (e.g., before our points were replaced with fewer ones), since
  // their blocks would be out of date (and we skip blocks from the top level, see skipBlocks()).

  lod.levels.length = nbOfLevels;

  // Determine how many of our leading points have sorted X values for their finite points (see Note #8 above), carrying
  // on from the last finite point that we have already processed, if any.

  let sortedLength = lod.sortedLength;

  if (sortedLength === from) {
    const previousIndex = previousFinitePoint(lod, xValues, yValues, sortedLength - 1);
    let previous = previousIndex >= 0 ? (xValues[previousIndex] as number) : Number.NEGATIVE_INFINITY;

    while (sortedLength < count) {
      const x = xValues[sortedLength] as number;
      const y = yValues[sortedLength] as number;

      if (x - x === 0 && y - y === 0) {
        if (x < previous) {
          break;
        }

        previous = x;
      }

      ++sortedLength;
    }

    lod.sortedLength = sortedLength;
  }

  lod.count = count;
};

// The result of a query (see query()), i.e. the index of the finite point with the minimum (and maximum) Y value of a
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

const queryPoints = (xValues: Float64Array, yValues: Float64Array, start: number, end: number): void => {
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
    const x = xValues[i] as number;
    const y = yValues[i] as number;

    if (x - x === 0 && y - y === 0) {
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

const query = (lod: ILevelOfDetail, xValues: Float64Array, yValues: Float64Array, start: number, end: number): void => {
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
        queryPoints(xValues, yValues, low, high);
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
      queryPoints(xValues, yValues, low, alignedLow);
      queryPoints(xValues, yValues, alignedHigh, high);
    }

    low = alignedLow / BLOCK_SIZE;
    high = alignedHigh / BLOCK_SIZE;
  }
};

const lowerBound = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  value: number
): number => {
  // Return the index of the first of the given points, between the given start and end, from which the first finite
  // point (if any) has an X value that is not less than the given value (or the given end if there is none), see Note
  // #8 above.
  // Note: if there is no finite point from our middle point to our high point, then our middle point is like our high
  //       point.

  let low = start;
  let high = end;

  while (low < high) {
    const middle = (low + high) >>> 1;
    const finite = skipBlocks(lod, xValues, yValues, middle, high, false);

    if (finite < high && (xValues[finite] as number) < value) {
      low = finite + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

const gallopingLowerBound = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  value: number
): number => {
  // Same as lowerBound(), but for a value that is expected to be close to the given start (e.g., the next column
  // boundary in selectPoints()), in which case it is faster.

  let low = start;
  let high = start;
  let step = 1;

  while (high < end) {
    const finite = skipBlocks(lod, xValues, yValues, high, end, false);

    if (finite === end || (xValues[finite] as number) >= value) {
      break;
    }

    low = finite + 1;
    high = finite + step;
    step *= 2;
  }

  return lowerBound(lod, xValues, yValues, low, Math.min(high, end), value);
};

const upperBound = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  value: number
): number => {
  // Same as lowerBound(), but for an X value that is greater than the given value.

  let low = start;
  let high = end;

  while (low < high) {
    const middle = (low + high) >>> 1;
    const finite = skipBlocks(lod, xValues, yValues, middle, high, false);

    if (finite < high && (xValues[finite] as number) <= value) {
      low = finite + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

export const visibleRange = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  count: number,
  xMin: number,
  xMax: number
): [start: number, end: number] => {
  // Return the range of the given points (whose finite points must have sorted X values, see Note #8 above) that we
  // need to draw for the given X range, i.e. the points within that range, as well as the points just before and after
  // it (so that our trace goes all the way to the edges of our plotting area).
  // Note: our level of detail must be up to date (see update()).

  const start = lowerBound(lod, xValues, yValues, 0, count, xMin);
  const end = upperBound(lod, xValues, yValues, start, count, xMax);

  return [Math.max(0, start - 1), Math.min(count, end + 1)];
};

export const neighbouringPoints = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  count: number,
  x: number
): [before: number, after: number] => {
  // Return the index of the last finite point, of the given points (whose finite points must have sorted X values, see
  // Note #8 above), that has an X value less than the given X value (or -1 if there is none), and the index of the
  // first finite point that has an X value not less than it (or the given number of points if there is none), e.g. so
  // that we can determine the point that gets hovered.
  // Note #1: our level of detail must be up to date (see update()).
  // Note #2: lowerBound() returns the point after the last finite point that has an X value less than the given X value
  //          (or our first point if there is none).

  const index = lowerBound(lod, xValues, yValues, 0, count, x);

  return [index - 1, skipBlocks(lod, xValues, yValues, index, count, false)];
};

const maxNbOfSelectedPoints = (nbOfColumns: number): number => {
  // Return the maximum number of points that selectPoints() may select for the given number of columns, if our points
  // have no gap (see Note #4 above).

  return 4 * (nbOfColumns + 2);
};

const selectionIndices = (selection: ISelection, nbOfPoints: number, nbOfNewPoints: number): Int32Array => {
  // Return the indices of the given selection, which has the given number of points, making sure that it can hold the
  // given number of new points (see Note #4 above).

  if (nbOfPoints + nbOfNewPoints > selection.indices.length) {
    const indices = new Int32Array(Math.max(nbOfPoints + nbOfNewPoints, 2 * selection.indices.length));

    indices.set(selection.indices.subarray(0, nbOfPoints));

    selection.indices = indices;
  }

  return selection.indices;
};

const skipBlocks = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  from: number,
  end: number,
  gaps: boolean
): number => {
  // Return the index of the first point, from the given point (included) to the given end (excluded), that is a gap (if
  // we are looking for gaps) or that is finite (otherwise), or the given end if there is none. To do so, we skip the
  // biggest blocks that we can, i.e. those that have no gap (if we are looking for gaps) or no finite point
  // (otherwise), see Note #4 above.
  // Note: a block that extends beyond our end can be skipped too, since none of its points before our end can be what
  //       we are looking for, in which case we are done.

  const levels = lod.levels;
  let i = from;

  while (i < end) {
    let skipped = false;

    for (let levelIndex = i % BLOCK_SIZE === 0 ? levels.length - 1 : -1; levelIndex >= 0; --levelIndex) {
      const blockSize = BLOCK_SIZE ** (levelIndex + 1);

      if (i % blockSize === 0) {
        const level = levels[levelIndex] as ILevel;
        const block = i / blockSize;

        if (gaps ? level.gap[block] === 0 : level.min[block] === -1) {
          i += blockSize;
          skipped = true;

          break;
        }
      }
    }

    if (!skipped) {
      if (isGap(xValues, yValues, i) === gaps) {
        return i;
      }

      ++i;
    }
  }

  return Math.min(i, end);
};

const selectRunPoints = (
  selection: ISelection,
  nbOfPoints: number,
  start: number,
  end: number,
  minIndex: number,
  maxIndex: number
): number => {
  // Select the first point of the given run of finite points, its points with the given minimum and maximum Y values
  // (in order), and its last point, add their index to the given selection (which already has the given number of
  // points), and return the new number of points.

  const indices = selectionIndices(selection, nbOfPoints, 4);
  const last = end - 1;
  const firstExtremum = Math.min(minIndex, maxIndex);
  const secondExtremum = Math.max(minIndex, maxIndex);
  let res = nbOfPoints;

  indices[res++] = start;

  if (firstExtremum > start && firstExtremum < last) {
    indices[res++] = firstExtremum;
  }

  if (secondExtremum > start && secondExtremum < last && secondExtremum !== firstExtremum) {
    indices[res++] = secondExtremum;
  }

  if (last > start) {
    indices[res++] = last;
  }

  return res;
};

const selectFiniteRunPoints = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  selection: ISelection,
  nbOfPoints: number,
  minIndex: number,
  maxIndex: number
): number => {
  // Select the points of the given run of finite points, which minimum and maximum Y values are known, if it doesn't
  // follow a gap. Otherwise, select its first point and the points of the rest of it (see Note #5 above).

  if (start === 0 || !isGap(xValues, yValues, start - 1) || end - start === 1) {
    return selectRunPoints(selection, nbOfPoints, start, end, minIndex, maxIndex);
  }

  selectionIndices(selection, nbOfPoints, 1)[nbOfPoints] = start;

  query(lod, xValues, yValues, start + 1, end);

  return selectRunPoints(
    selection,
    nbOfPoints + 1,
    start + 1,
    end,
    queryResult[QUERY_MIN_INDEX] as number,
    queryResult[QUERY_MAX_INDEX] as number
  );
};

const selectRangePoints = (
  lod: ILevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  selection: ISelection,
  nbOfPoints: number
): number => {
  // Select the points of the given range (see Note #1 and Note #4 above), add their index to the given selection (which
  // already has the given number of points), and return the new number of points.

  // Select all the points of a range that has up to four of them.

  if (end - start <= 4) {
    const indices = selectionIndices(selection, nbOfPoints, end - start);
    let res = nbOfPoints;

    for (let i = start; i < end; ++i) {
      indices[res++] = i;
    }

    return res;
  }

  // Select the first, minimum, maximum, and last points of a range that has no gap.

  query(lod, xValues, yValues, start, end);

  if (!queryResult[QUERY_HAS_GAP]) {
    return selectFiniteRunPoints(
      lod,
      xValues,
      yValues,
      start,
      end,
      selection,
      nbOfPoints,
      queryResult[QUERY_MIN_INDEX] as number,
      queryResult[QUERY_MAX_INDEX] as number
    );
  }

  // Our range has gaps, so select the first point of each gap and the points of each run of finite points.

  let res = nbOfPoints;
  let i = start;

  while (i < end) {
    if (isGap(xValues, yValues, i)) {
      selectionIndices(selection, res, 1)[res++] = i;

      i = skipBlocks(lod, xValues, yValues, i + 1, end, false);
    } else {
      const runEnd = skipBlocks(lod, xValues, yValues, i + 1, end, true);

      query(lod, xValues, yValues, i, runEnd);

      res = selectFiniteRunPoints(
        lod,
        xValues,
        yValues,
        i,
        runEnd,
        selection,
        res,
        queryResult[QUERY_MIN_INDEX] as number,
        queryResult[QUERY_MAX_INDEX] as number
      );
      i = runEnd;
    }
  }

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
): ISelection => {
  // Select the points, in the given range (see visibleRange()), that we need to draw for the given X range split into
  // the given number of columns (see Note #1 and Note #4 above).
  // Note: our level of detail must be up to date (see update()).

  // Our points are selected range by range, i.e. iteration k selects the points of [b(k - 1), b(k)), where b(-1) is
  // our start, b(k) is the first point from which the first finite point has an X value that is not less than
  // boundary(k) (for 0 <= k <= nbOfColumns, see lowerBound()), and b(nbOfColumns + 1) is our end.

  const columnWidth = (xMax - xMin) / nbOfColumns;
  const boundary = (k: number): number => (k === nbOfColumns ? xMax : xMin + k * columnWidth);
  let selection = lod.selection;
  let iteration = 0;
  let rangeStart = start;
  let nbOfPoints = 0;

  // Check whether we can reuse (some of) our previous selection (see Note #6 above), i.e. resume from the range that
  // contains the last finite point up to the first point that may have changed (or the last point that we previously
  // had).
  // Note: the ranges before that range only depend on the points up to that finite point (see lowerBound()), so they
  //       cannot have changed.

  if (
    selection &&
    selection.xMin === xMin &&
    selection.xMax === xMax &&
    selection.nbOfColumns === nbOfColumns &&
    selection.start === start
  ) {
    const finitePoint = previousFinitePoint(lod, xValues, yValues, Math.min(selection.validCount, selection.end) - 1);

    if (finitePoint >= start) {
      // Determine the last boundary that is not greater than the X value of our finite point, if any.

      const x = xValues[finitePoint] as number;
      let k = Math.max(-1, Math.min(nbOfColumns, Math.floor((x - xMin) / columnWidth)));

      while (k < nbOfColumns && boundary(k + 1) <= x) {
        ++k;
      }

      while (k >= 0 && boundary(k) > x) {
        --k;
      }

      if (k >= 0) {
        iteration = k + 1;
        rangeStart = lowerBound(lod, xValues, yValues, start, end, boundary(k));

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
  // Note: we keep track of the first finite point from our range start, so that we don't have to look for it again for
  //       each of our ranges that is empty (e.g., for each column within a long gap, which we would otherwise have to
  //       skip again, see lowerBound()).

  selection.firstChanged = nbOfPoints;

  let nextFinitePoint = -1;

  for (; iteration <= nbOfColumns + 1; ++iteration) {
    let rangeEnd = end;

    if (iteration <= nbOfColumns) {
      const value = iteration === nbOfColumns ? xMax : xMin + iteration * columnWidth;

      if (nextFinitePoint < rangeStart) {
        nextFinitePoint = skipBlocks(lod, xValues, yValues, rangeStart, end, false);
      }

      rangeEnd =
        nextFinitePoint === end || (xValues[nextFinitePoint] as number) >= value
          ? rangeStart
          : gallopingLowerBound(lod, xValues, yValues, nextFinitePoint + 1, end, value);
    }

    nbOfPoints = selectRangePoints(lod, xValues, yValues, rangeStart, rangeEnd, selection, nbOfPoints);
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
