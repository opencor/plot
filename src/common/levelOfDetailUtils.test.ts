import { describe, expect, it } from 'bun:test';

import {
  create,
  type LevelOfDetail,
  type LevelOfDetailSelection,
  invalidate,
  memoryUsage,
  neighbouringPoints,
  selectPoints,
  update,
  visibleRange
} from './levelOfDetailUtils';

// Some helpers.

const randomGenerator = (seed: number): (() => number) => {
  // Return a deterministic pseudo-random number generator (Mulberry32), so that our tests are reproducible.

  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const levelOfDetail = (xValues: Float64Array, yValues: Float64Array, count: number = xValues.length): LevelOfDetail => {
  // Return an up-to-date level of detail for the given points.

  const res = create();

  update(res, xValues, yValues, count);

  return res;
};

const selectedIndices = (selection: LevelOfDetailSelection | undefined): number[] => {
  // Return the indices of the given selection.

  return selection ? Array.from(selection.indices.subarray(0, selection.nbOfPoints)) : [];
};

const isFinitePoint = (xValues: Float64Array, yValues: Float64Array, index: number): boolean => {
  // Return whether the given point is finite, i.e. whether both its X and Y values are finite.

  return Number.isFinite(xValues[index] as number) && Number.isFinite(yValues[index] as number);
};

const checkSelection = (
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  xMin: number,
  xMax: number,
  nbOfColumns: number,
  selection: LevelOfDetailSelection | undefined
): void => {
  // Check that the given selection is what we need to draw the given points for the given X range split into the given
  // number of columns, i.e. that, for each range of points (see selectPoints()), all of its points are selected if it
  // has up to four of them. Otherwise, for each run of finite points of that range, its first and last points, as well
  // as points with its minimum and maximum Y values, and no more than four points in total, are selected (with the
  // first point of a run that starts our selection or that follows a gap being selected on its own, and the rest of
  // the run being selected that way), and for each gap of that range (i.e. points with a non-finite X or Y value), its
  // first point is selected.
  // Note: we determine our ranges of points and their runs in a brute-force way, i.e. without relying on
  //       levelOfDetailUtils.ts.

  if (selection === undefined) {
    throw new Error('No selection.');
  }

  const indices = selectedIndices(selection);
  const columnWidth = (xMax - xMin) / nbOfColumns;
  let rangeStart = start;
  let index = 0;

  expect(indices.length).toBeLessThanOrEqual(selection.indices.length);

  for (let k = 0; k <= nbOfColumns + 1; ++k) {
    let rangeEnd = rangeStart;

    if (k > nbOfColumns) {
      rangeEnd = end;
    } else {
      // Our range ends after the last finite point that is before our boundary (i.e. the gaps that follow it are in
      // the next range).

      const boundary = k === nbOfColumns ? xMax : xMin + k * columnWidth;

      for (let i = rangeStart; i < end; ++i) {
        if (isFinitePoint(xValues, yValues, i)) {
          if ((xValues[i] as number) >= boundary) {
            break;
          }

          rangeEnd = i + 1;
        }
      }
    }

    // Retrieve the selected points of our range.

    const rangeIndices: number[] = [];

    while (index < indices.length && (indices[index] as number) < rangeEnd) {
      rangeIndices.push(indices[index++] as number);
    }

    if (rangeEnd - rangeStart <= 4) {
      expect(rangeIndices).toEqual(Array.from({ length: rangeEnd - rangeStart }, (_value, i) => rangeStart + i));
    } else {
      expect(rangeIndices).toEqual([...rangeIndices].sort((a, b) => a - b));
      expect(new Set(rangeIndices).size).toBe(rangeIndices.length);

      let nbOfRunIndices = 0;

      for (let runStart = rangeStart; runStart < rangeEnd; ) {
        const finite = isFinitePoint(xValues, yValues, runStart);
        let runEnd = runStart + 1;

        while (runEnd < rangeEnd && isFinitePoint(xValues, yValues, runEnd) === finite) {
          ++runEnd;
        }

        let runIndices = rangeIndices.filter((i) => i >= runStart && i < runEnd);

        nbOfRunIndices += runIndices.length;

        if (finite) {
          // A run that starts our selection or that follows a gap has its first point selected on its own.

          let checkedRunStart = runStart;

          if ((runStart === start || !isFinitePoint(xValues, yValues, runStart - 1)) && runEnd - runStart > 1) {
            expect(runIndices[0]).toBe(runStart);

            runIndices = runIndices.slice(1);
            checkedRunStart = runStart + 1;
          }

          const runYValues = Array.from(yValues.subarray(checkedRunStart, runEnd));
          const selectedYValues = runIndices.map((i) => yValues[i] as number);

          expect(runIndices.length).toBeLessThanOrEqual(4);
          expect(runIndices[0]).toBe(checkedRunStart);
          expect(runIndices.at(-1)).toBe(runEnd - 1);
          expect(Math.min(...selectedYValues)).toBe(Math.min(...runYValues));
          expect(Math.max(...selectedYValues)).toBe(Math.max(...runYValues));
        } else {
          expect(runIndices).toEqual([runStart]);
        }

        runStart = runEnd;
      }

      expect(nbOfRunIndices).toBe(rangeIndices.length);
    }

    rangeStart = rangeEnd;
  }

  // Make sure that all of our selected points were within our ranges.

  expect(index).toBe(indices.length);
};

const randomGap = (random: () => number, xValues: Float64Array, yValues: Float64Array, index: number): void => {
  // Make the given point a gap, i.e. give it a non-finite Y value (with or without an X value that is not sorted) or a
  // non-finite X value.

  const GAPS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const gap = GAPS[Math.floor(3 * random())] as number;
  const kind = random();

  if (kind < 0.4) {
    yValues[index] = gap;
  } else if (kind < 0.6) {
    xValues[index] = -1000 * random();
    yValues[index] = gap;
  } else {
    xValues[index] = gap;
  }
};

const randomPoints = (random: () => number, nbOfPoints: number, gaps = false): [Float64Array, Float64Array] => {
  // Return some random points, with sorted X values (some of which are the same) and random Y values, some of which
  // may be gaps (see randomGap()), either isolated ones or runs of them (of up to 1,000 points, so that some blocks
  // have no finite points, while other blocks have no gap).

  const xValues = new Float64Array(nbOfPoints);
  const yValues = new Float64Array(nbOfPoints);
  let x = 0;
  let gapLength = 0;

  for (let i = 0; i < nbOfPoints; ++i) {
    x += random() < 0.1 ? 0 : random();

    xValues[i] = x;
    yValues[i] = 1000 * (random() - 0.5);

    if (gaps) {
      if (gapLength === 0 && random() < 0.002) {
        gapLength = 1 + Math.floor(1000 * random());
      }

      if (gapLength > 0) {
        --gapLength;

        randomGap(random, xValues, yValues, i);
      } else if (random() < 0.02) {
        randomGap(random, xValues, yValues, i);
      }
    }
  }

  return [xValues, yValues];
};

const sortedLengthOf = (xValues: Float64Array, yValues: Float64Array, count: number): number => {
  // Return the number of leading points whose finite points have sorted X values, in a brute-force way.

  let previous = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < count; ++i) {
    if (isFinitePoint(xValues, yValues, i)) {
      if ((xValues[i] as number) < previous) {
        return i;
      }

      previous = xValues[i] as number;
    }
  }

  return count;
};

// create().

describe('create()', () => {
  it('creates an empty level of detail', () => {
    expect(create()).toEqual({
      xValues: undefined,
      yValues: undefined,
      count: 0,
      sortedLength: 0,
      levels: [],
      selection: undefined,
      nbOfSelections: 0
    });
  });
});

// memoryUsage().

describe('memoryUsage()', () => {
  it('returns the number of bytes used by its blocks and its selection', () => {
    const nbOfPoints = 256;
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i);
    const lod = create();

    expect(memoryUsage(lod)).toBe(0);

    // Our blocks of points and blocks of blocks, each of which has a minimum index, a maximum index (both 32-bit
    // integers), and a gap flag (an 8-bit integer).

    update(lod, xValues, xValues, nbOfPoints);

    const blocksMemoryUsage = lod.levels.reduce((sum, level) => sum + 9 * level.min.length, 0);

    expect(lod.levels.length).toBe(2);
    expect(memoryUsage(lod)).toBe(blocksMemoryUsage);

    // Our selection, i.e. the (32-bit integer) index of our selected points.

    const selection = selectPoints(
      lod,
      xValues,
      xValues,
      0,
      nbOfPoints,
      0,
      nbOfPoints - 1,
      10
    ) as LevelOfDetailSelection;

    expect(memoryUsage(lod)).toBe(blocksMemoryUsage + 4 * selection.indices.length);
  });
});

// update().

describe('update()', () => {
  const sortedLength = (xValues: number[], yValues: number[] = new Array(xValues.length).fill(0)): number => {
    return levelOfDetail(Float64Array.from(xValues), Float64Array.from(yValues)).sortedLength;
  };

  it('determines how many leading points have sorted X values for their finite points', () => {
    expect(sortedLength([])).toBe(0);
    expect(sortedLength([1, 2, 2, 3])).toBe(4);
    expect(sortedLength([1, 3, 2, 4])).toBe(2);

    // Gaps are skipped, whether they have a non-finite X value or a non-finite Y value (in which case their X value
    // doesn't matter).

    expect(sortedLength([1, Number.NaN, 3])).toBe(3);
    expect(sortedLength([Number.NEGATIVE_INFINITY, 1])).toBe(2);
    expect(sortedLength([1, Number.POSITIVE_INFINITY])).toBe(2);
    expect(sortedLength([1, Number.NaN, 0])).toBe(2);
    expect(sortedLength([1, 0, 2], [0, Number.NaN, 0])).toBe(3);
    expect(sortedLength([1, 0, 2], [0, 0, Number.NaN])).toBe(1);

    // Same, for some random points (with many gaps), and for those points with some unsorted X values.

    const random = randomGenerator(789);

    for (let run = 0; run < 20; ++run) {
      const nbOfPoints = 1 + Math.floor(10000 * random());
      const [xValues, yValues] = randomPoints(random, nbOfPoints, true);

      if (run % 2) {
        xValues[Math.floor(nbOfPoints * random())] = -1;
      }

      expect(levelOfDetail(xValues, yValues).sortedLength).toBe(sortedLengthOf(xValues, yValues, nbOfPoints));
    }
  });

  it('carries on from the last finite point that it has already processed', () => {
    // Our points have a gap of 1,000 points (i.e. whole blocks of points without a finite point), after which our
    // points must still be sorted, so it needs to retrieve the last finite point before it.

    const nbOfPoints = 2000;
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => (i >= 500 && i < 1500 ? Number.NaN : i));
    const yValues = new Float64Array(nbOfPoints);
    const lod = levelOfDetail(xValues, yValues, 1200);

    expect(lod.sortedLength).toBe(1200);

    xValues[1500] = 499;

    update(lod, xValues, yValues, nbOfPoints);

    expect(lod.sortedLength).toBe(nbOfPoints);

    xValues[1500] = 498;

    invalidate(lod, 1200);
    update(lod, xValues, yValues, nbOfPoints);

    expect(lod.sortedLength).toBe(1500);
  });

  it('drops the blocks that it no longer needs', () => {
    const xValues = Float64Array.from({ length: 1000 }, (_value, i) => i);
    const lod = levelOfDetail(xValues, xValues);

    expect(lod.levels.length).toBe(2);

    invalidate(lod, 0);
    update(lod, xValues, xValues, 100);

    expect(lod.levels.length).toBe(1);

    invalidate(lod, 0);
    update(lod, xValues, xValues, 10);

    expect(lod.levels.length).toBe(0);
  });

  it('carries on from the points that it has already processed', () => {
    const xValues = Float64Array.from([1, 2, 3, 4, 0, 6]);
    const yValues = new Float64Array(xValues.length);
    const lod = levelOfDetail(xValues, yValues, 3);

    expect(lod.count).toBe(3);
    expect(lod.sortedLength).toBe(3);

    // Our last point may change, so it must be processed again.

    xValues[2] = 5;

    invalidate(lod, 2);
    update(lod, xValues, yValues, 4);

    expect(lod.count).toBe(4);
    expect(lod.sortedLength).toBe(3);

    // Once some points are not sorted, then the following ones are not looked at (since they cannot make our points
    // sorted again).

    update(lod, xValues, yValues, 6);

    expect(lod.count).toBe(6);
    expect(lod.sortedLength).toBe(3);
  });

  it('does nothing if there are no new points to process', () => {
    const xValues = Float64Array.from([1, 2, 3]);
    const yValues = new Float64Array(xValues.length);
    const lod = levelOfDetail(xValues, yValues);

    xValues[0] = 9;

    update(lod, xValues, yValues, 3);
    update(lod, xValues, yValues, 2);

    expect(lod.count).toBe(3);
    expect(lod.sortedLength).toBe(3);
  });

  it('processes all of its points again if they are not a continuation of the ones it was last updated with', () => {
    // A level of detail may be shared, so it may get updated with some values (e.g., by one of its users), then with
    // other values (e.g., by another of its users), and then with a continuation of the first values (e.g., by the
    // first user again), in which case it must not keep what it did for the other values (see Note #9 of
    // levelOfDetailUtils.ts).

    const random = randomGenerator(963);
    const [xBuffer, yBuffer] = randomPoints(random, 6000, true);
    const [otherXValues, otherYValues] = randomPoints(random, 6000, true);
    const xValues = xBuffer.subarray(0, 6000);
    const yValues = yBuffer.subarray(0, 6000);
    const lod = create();

    update(lod, xBuffer.subarray(0, 5000), yBuffer.subarray(0, 5000), 5000);
    update(
      lod,
      otherXValues,
      otherYValues.map((y) => -y),
      6000
    );
    update(lod, xValues, yValues, 6000);

    const freshLod = levelOfDetail(xValues, yValues);

    const usedBlocks = (levelOfDetail: LevelOfDetail): number[][] => {
      // Return the blocks of the given level of detail that are in use (i.e. not its spare capacity).

      return levelOfDetail.levels.map((level, index) => {
        const nbOfBlocks = Math.floor(6000 / 16 ** (index + 1));

        return [
          ...level.min.subarray(0, nbOfBlocks),
          ...level.max.subarray(0, nbOfBlocks),
          ...level.gap.subarray(0, nbOfBlocks)
        ];
      });
    };

    expect(lod.sortedLength).toBe(freshLod.sortedLength);
    expect(usedBlocks(lod)).toEqual(usedBlocks(freshLod));
    expect(selectedIndices(selectPoints(lod, xValues, yValues, 0, 6000, 0, 6000, 50))).toEqual(
      selectedIndices(selectPoints(freshLod, xValues, yValues, 0, 6000, 0, 6000, 50))
    );
  });

  it('processes a continuation from its last point, and nothing for the very same values', () => {
    // Our last point may have changed in a continuation (e.g., a live simulation retrieves it again), but the very same
    // values (i.e. the same arrays) are assumed not to have changed (see Note #9 of levelOfDetailUtils.ts).

    const xBuffer = Float64Array.from({ length: 100 }, (_value, i) => i);
    const yBuffer = new Float64Array(100);
    const lod = create();

    update(lod, xBuffer.subarray(0, 50), yBuffer.subarray(0, 50), 50);

    // The very same values: nothing gets processed again, even if we invalidate nothing ourselves.

    const xValues = xBuffer.subarray(0, 80);
    const yValues = yBuffer.subarray(0, 80);

    yBuffer[49] = 7;

    update(lod, xValues, yValues, 80);

    expect(lod.levels[0]?.max[3]).toBe(49);

    yBuffer[79] = 9;

    update(lod, xValues, yValues, 80);

    expect(lod.levels[0]?.max[4]).not.toBe(79);
  });

  it('creates blocks of points, blocks of blocks, and so on', () => {
    const blocks = (nbOfPoints: number): number => {
      return levelOfDetail(new Float64Array(nbOfPoints), new Float64Array(nbOfPoints)).levels.length;
    };

    expect(blocks(15)).toBe(0);
    expect(blocks(16)).toBe(1);
    expect(blocks(255)).toBe(1);
    expect(blocks(256)).toBe(2);
    expect(blocks(4096)).toBe(3);
  });
});

// invalidate().

describe('invalidate()', () => {
  it('invalidates our points from the given point onwards', () => {
    const xValues = Float64Array.from({ length: 10 }, (_value, i) => i);
    const yValues = new Float64Array(10);
    const lod = levelOfDetail(xValues, yValues);

    selectPoints(lod, xValues, yValues, 0, 10, 0, 9, 2);

    invalidate(lod, 7);

    expect(lod.count).toBe(7);
    expect(lod.sortedLength).toBe(7);
    expect(lod.selection?.validCount).toBe(7);

    // Invalidating from a later point doesn't change anything.

    invalidate(lod, 8);

    expect(lod.count).toBe(7);
    expect(lod.sortedLength).toBe(7);
    expect(lod.selection?.validCount).toBe(7);
  });

  it('works without a selection', () => {
    const lod = levelOfDetail(Float64Array.from([1, 2, 3]), new Float64Array(3));

    invalidate(lod, 1);

    expect(lod.count).toBe(1);
    expect(lod.selection).toBeUndefined();
  });
});

// visibleRange().

describe('visibleRange()', () => {
  const range = (
    xValues: number[],
    count: number,
    xMin: number,
    xMax: number,
    yValues: number[] = new Array(xValues.length).fill(0)
  ): [number, number] => {
    const xs = Float64Array.from(xValues);
    const ys = Float64Array.from(yValues);

    return visibleRange(levelOfDetail(xs, ys, count), xs, ys, count, xMin, xMax);
  };
  const xValues = [0, 1, 2, 3, 4, 5];

  it('returns the points within the given X range, as well as the points just before and after it', () => {
    expect(range(xValues, 6, 1.5, 3.5)).toEqual([1, 5]);
    expect(range(xValues, 6, 1, 3)).toEqual([0, 5]);
    expect(range(xValues, 6, 0, 5)).toEqual([0, 6]);
    expect(range(xValues, 6, -10, 10)).toEqual([0, 6]);
  });

  it('handles an X range that is before or after all the points', () => {
    expect(range(xValues, 6, -5, -1)).toEqual([0, 1]);
    expect(range(xValues, 6, 10, 20)).toEqual([5, 6]);
  });

  it('only considers the given number of points', () => {
    expect(range(xValues, 3, 0, 10)).toEqual([0, 3]);
  });

  it('handles points with the same X value', () => {
    expect(range([0, 1, 1, 1, 2], 5, 1, 1)).toEqual([0, 5]);
  });

  it('skips gaps, whatever their X value', () => {
    const N = Number.NaN;

    // Our last finite point before our X range is point 1 (since point 3 is a gap, whatever its X value), and our last
    // finite point within our X range is point 6, which is followed by a gap (point 7).

    expect(range([0, 1, N, 9, 3, N, 5, N, -1, 7, 8], 11, 3, 6, [0, 0, 0, N, 0, 0, 0, 0, N, 0, 0])).toEqual([1, 8]);

    // Our only finite point is within our X range, and it is followed by some gaps, the first of which is in our range.

    expect(range([N, N, 4, N, N], 5, 3, 6)).toEqual([0, 4]);

    // We have no finite point.

    expect(range([N, N, N], 3, 3, 6)).toEqual([0, 1]);
  });
});

// neighbouringPoints().

describe('neighbouringPoints()', () => {
  it('returns the finite points on either side of the given X value, skipping gaps', () => {
    const N = Number.NaN;
    const xValues = Float64Array.from([N, 1, 2, -9, N, 5, 5, 6, N]);
    const yValues = Float64Array.from([0, 0, 0, N, 0, 0, 0, 0, 0]);
    const lod = levelOfDetail(xValues, yValues);
    const neighbours = (x: number): [number, number] => neighbouringPoints(lod, xValues, yValues, 9, x);

    // Points 3 and 4 are gaps (whatever their X value), and so are points 0 and 8.

    expect(neighbours(0)).toEqual([-1, 1]);
    expect(neighbours(1)).toEqual([-1, 1]);
    expect(neighbours(1.5)).toEqual([1, 2]);
    expect(neighbours(3)).toEqual([2, 5]);
    expect(neighbours(5)).toEqual([2, 5]);
    expect(neighbours(5.5)).toEqual([6, 7]);
    expect(neighbours(7)).toEqual([7, 9]);
  });

  it('returns the same finite points as a brute-force search, for some random points with or without gaps', () => {
    const random = randomGenerator(321);

    for (const gaps of [false, true]) {
      const nbOfPoints = 50000;
      const [xValues, yValues] = randomPoints(random, nbOfPoints, gaps);
      const lod = levelOfDetail(xValues, yValues);
      const xLast = xValues.reduce((max, x) => (Number.isFinite(x) ? Math.max(max, x) : max), 0);

      for (let run = 0; run < 200; ++run) {
        const x = xLast * (1.2 * random() - 0.1);
        let before = -1;
        let after = nbOfPoints;

        for (let i = 0; i < nbOfPoints; ++i) {
          if (isFinitePoint(xValues, yValues, i)) {
            if ((xValues[i] as number) < x) {
              before = i;
            } else {
              after = i;

              break;
            }
          }
        }

        expect(neighbouringPoints(lod, xValues, yValues, nbOfPoints, x)).toEqual([before, after]);
      }
    }
  });
});

// selectPoints().

describe('selectPoints()', () => {
  it('numbers its selections', () => {
    const nbOfPoints = 256;
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i);
    const lod = create();

    update(lod, xValues, xValues, nbOfPoints);

    // Our selections are numbered whether or not they reuse (some of) the previous one.

    const selection = selectPoints(
      lod,
      xValues,
      xValues,
      0,
      nbOfPoints,
      0,
      nbOfPoints - 1,
      10
    ) as LevelOfDetailSelection;

    expect(selection.number).toBe(1);

    expect(selectPoints(lod, xValues, xValues, 0, nbOfPoints, 0, nbOfPoints - 1, 10)?.number).toBe(2);
    expect(selectPoints(lod, xValues, xValues, 0, nbOfPoints, 0, nbOfPoints - 1, 20)?.number).toBe(3);
    expect(lod.nbOfSelections).toBe(3);
  });

  it('selects the points needed to draw some points, with or without gaps', () => {
    // Check our selection for different numbers of points (so that we have up to five levels of blocks), with or
    // without gaps, X ranges, and numbers of columns.

    const random = randomGenerator(123);

    for (const [nbOfPoints, gaps] of [1, 5, 50, 1000, 5000, 70000].flatMap((n) => [
      [n, false] as const,
      [n, true] as const
    ])) {
      const [xValues, yValues] = randomPoints(random, nbOfPoints, gaps);
      const lod = levelOfDetail(xValues, yValues);
      const xLast = xValues.reduce((max, x) => (Number.isFinite(x) ? Math.max(max, x) : max), 0);

      for (let run = 0; run < 20; ++run) {
        const xMin = xLast * (1.2 * random() - 0.1);
        const xMax = xMin + xLast * (0.01 + random());
        const nbOfColumns = 1 + Math.floor(300 * random());
        const [start, end] = visibleRange(lod, xValues, yValues, nbOfPoints, xMin, xMax);
        const selection = selectPoints(lod, xValues, yValues, start, end, xMin, xMax, nbOfColumns);

        checkSelection(xValues, yValues, start, end, xMin, xMax, nbOfColumns, selection);
      }
    }
  });

  it('selects all the points of a range that has up to four of them', () => {
    const xValues = Float64Array.from([0, 1, 2, 3]);
    const yValues = Float64Array.from([3, 1, 4, 1]);

    expect(selectedIndices(selectPoints(levelOfDetail(xValues, yValues), xValues, yValues, 0, 4, 0, 3, 1))).toEqual([
      0, 1, 2, 3
    ]);
  });

  it('selects the first and last points, and the points with the minimum and maximum Y values, of a range', () => {
    const xValues = Float64Array.from({ length: 11 }, (_value, i) => i);
    const select = (y: number[]): number[] => {
      const yValues = Float64Array.from([5, ...y]);

      return selectedIndices(selectPoints(levelOfDetail(xValues, yValues), xValues, yValues, 0, 11, 11, 21, 1));
    };

    // Note: our X range is after all of our points, so they are all in the same range. However, our first point starts
    //       our selection, so it gets selected on its own and the rest of our points (i.e. the given ones, from index
    //       1) get selected as a range (see Note #5 of levelOfDetailUtils.ts).

    expect(select([0, 1, 9, 2, 3, -9, 4, 5, 6, 7])).toEqual([0, 1, 3, 6, 10]);

    // A minimum or maximum that is the first or last point of our range isn't selected twice.

    expect(select([-9, 1, 9, 2, 3, 0, 4, 5, 6, 7])).toEqual([0, 1, 3, 10]);
    expect(select([0, 1, 2, 2, 3, -9, 4, 5, 6, 9])).toEqual([0, 1, 6, 10]);
    expect(select([-9, 1, 2, 2, 3, 0, 4, 5, 6, 9])).toEqual([0, 1, 10]);
  });

  it('handles points with the same Y value', () => {
    const nbOfPoints = 1000;
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i);
    const yValues = new Float64Array(nbOfPoints).fill(3);
    const lod = levelOfDetail(xValues, yValues);

    for (const [start, end] of [
      [0, nbOfPoints],
      [5, 900],
      [16, 512]
    ] as const) {
      checkSelection(
        xValues,
        yValues,
        start,
        end,
        0,
        nbOfPoints,
        7,
        selectPoints(lod, xValues, yValues, start, end, 0, nbOfPoints, 7)
      );
    }
  });

  it('selects the points of each run of finite points, and the first point of each gap, of a range', () => {
    const xValues = Float64Array.from({ length: 13 }, (_value, i) => i);
    const yValues = Float64Array.from([
      0,
      5,
      -5,
      1,
      Number.NaN,
      Number.NaN,
      2,
      Number.POSITIVE_INFINITY,
      -9,
      3,
      9,
      5,
      4
    ]);

    // Note #1: our X range is after all of our points, so they are all in the same range.
    // Note #2: the last run of finite points follows a gap, so its first point (point 8) is selected on its own and is
    //          not taken into account when selecting the points of the rest of the run (i.e. points 9, 10, and 12).

    expect(selectedIndices(selectPoints(levelOfDetail(xValues, yValues), xValues, yValues, 0, 13, 20, 30, 1))).toEqual([
      0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12
    ]);

    // Same with gaps that are due to a non-finite X value, or to a non-finite Y value but with an X value that is not
    // sorted.

    xValues[4] = Number.NaN;
    xValues[5] = -5;
    xValues[7] = Number.POSITIVE_INFINITY;
    yValues[4] = 1;
    yValues[7] = 2;

    expect(selectedIndices(selectPoints(levelOfDetail(xValues, yValues), xValues, yValues, 0, 13, 20, 30, 1))).toEqual([
      0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12
    ]);
  });

  it('grows its selection if needed', () => {
    // Every other point is a gap, so all of our points get selected, i.e. many more than we would select without gaps.

    const nbOfPoints = 1000;
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i);
    const yValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => (i % 2 ? Number.NaN : Math.sin(i)));
    const lod = levelOfDetail(xValues, yValues);
    const selection = selectPoints(lod, xValues, yValues, 0, nbOfPoints, 0, nbOfPoints, 10);

    expect(selection.nbOfPoints).toBe(nbOfPoints);
    expect(selection.indices.length).toBeGreaterThanOrEqual(nbOfPoints);
    checkSelection(xValues, yValues, 0, nbOfPoints, 0, nbOfPoints, 10, selection);

    // Our grown selection gets reused, keeping its leading points.

    yValues[nbOfPoints - 1] = 7;

    invalidate(lod, nbOfPoints - 1);
    update(lod, xValues, yValues, nbOfPoints);

    const indices = selectedIndices(selection);
    const newSelection = selectPoints(lod, xValues, yValues, 0, nbOfPoints, 0, nbOfPoints, 10);

    expect(newSelection.firstChanged).toBeGreaterThan(0);
    expect(selectedIndices(newSelection).slice(0, newSelection.firstChanged)).toEqual(
      indices.slice(0, newSelection.firstChanged)
    );
    checkSelection(xValues, yValues, 0, nbOfPoints, 0, nbOfPoints, 10, newSelection);
  });

  it('selects the points of new data the same way, whether incrementally or from scratch, with or without gaps', () => {
    // Simulate some live data, i.e. points that get appended to (by a random number of points at a time) and which last
    // point gets retrieved again (and may therefore change), and that are drawn for a fixed X range. At each step,
    // check that our selection is the same as the one we get from scratch, and that it reuses the points of our
    // previous selection that cannot have changed.

    for (const gaps of [false, true]) {
      const random = randomGenerator(456);
      const NB_OF_POINTS = 3000;
      const X_MAX = 0.1 * NB_OF_POINTS;
      const NB_OF_COLUMNS = 50;
      const xValues = new Float64Array(NB_OF_POINTS);
      const yValues = new Float64Array(NB_OF_POINTS);
      const lod = create();
      let count = 0;
      let nbOfReuses = 0;

      while (count < NB_OF_POINTS) {
        const newCount = Math.min(NB_OF_POINTS, count + 1 + Math.floor(50 * random()));
        const gapBatch = gaps && random() < 0.2;

        if (count > 0 && random() < 0.5) {
          xValues[count - 1] = 0.1 * (count - 1);
          yValues[count - 1] = random();
        }

        for (let i = count; i < newCount; ++i) {
          xValues[i] = 0.1 * i;
          yValues[i] = random();

          if (gapBatch || (gaps && random() < 0.1)) {
            randomGap(random, xValues, yValues, i);
          }
        }

        invalidate(lod, Math.max(0, count - 1));
        update(lod, xValues, yValues, newCount);

        count = newCount;

        expect(lod.sortedLength).toBe(count);

        const previousIndices = selectedIndices(lod.selection);
        const [start, end] = visibleRange(lod, xValues, yValues, count, 0, X_MAX);
        const selection = selectPoints(lod, xValues, yValues, start, end, 0, X_MAX, NB_OF_COLUMNS);
        const fromScratch = selectPoints(
          levelOfDetail(xValues.slice(0, count), yValues.slice(0, count)),
          xValues,
          yValues,
          start,
          end,
          0,
          X_MAX,
          NB_OF_COLUMNS
        );

        expect(selectedIndices(selection)).toEqual(selectedIndices(fromScratch));
        expect(selectedIndices(selection).slice(0, selection?.firstChanged)).toEqual(
          previousIndices.slice(0, selection?.firstChanged)
        );

        if (selection?.firstChanged) {
          ++nbOfReuses;
        }
      }

      // Make sure that we actually reused some of our previous selections.

      expect(nbOfReuses).toBeGreaterThan(10);
    }
  });

  it('selects all of its points again if the X range, number of columns, or start is different', () => {
    const xValues = Float64Array.from({ length: 100 }, (_value, i) => i);
    const yValues = Float64Array.from({ length: 100 }, (_value, i) => Math.sin(i));
    const lod = levelOfDetail(xValues, yValues);

    selectPoints(lod, xValues, yValues, 0, 100, 0, 99, 10);

    expect(selectPoints(lod, xValues, yValues, 0, 100, 0, 99, 10)?.firstChanged).toBeGreaterThan(0);
    expect(selectPoints(lod, xValues, yValues, 0, 100, 1, 99, 10)?.firstChanged).toBe(0);
    expect(selectPoints(lod, xValues, yValues, 0, 100, 1, 98, 10)?.firstChanged).toBe(0);
    expect(selectPoints(lod, xValues, yValues, 0, 100, 1, 98, 11)?.firstChanged).toBe(0);
    expect(selectPoints(lod, xValues, yValues, 1, 100, 1, 98, 11)?.firstChanged).toBe(0);
  });

  it('selects all of its points again if none of them can be reused', () => {
    const xValues = Float64Array.from({ length: 100 }, (_value, i) => i);
    const yValues = Float64Array.from({ length: 100 }, (_value, i) => Math.sin(i));
    const lod = levelOfDetail(xValues, yValues);

    selectPoints(lod, xValues, yValues, 0, 100, 10, 90, 10);

    // All of our points may have changed.

    invalidate(lod, 0);
    update(lod, xValues, yValues, 100);

    expect(selectPoints(lod, xValues, yValues, 0, 100, 10, 90, 10)?.firstChanged).toBe(0);

    // Our first changed point is before our X range.

    invalidate(lod, 5);
    update(lod, xValues, yValues, 100);

    expect(selectPoints(lod, xValues, yValues, 0, 100, 10, 90, 10)?.firstChanged).toBe(0);
  });

  it('determines the range of the first changed point despite rounding errors', () => {
    // Note: the column of a point is first estimated using a division, which may be off by one due to rounding errors.
    //       So, we check that we get the correct selection for points (found by trial and error) for which this is the
    //       case, i.e. a point that is on a boundary, but which is estimated to be in the previous column, and a point
    //       that is just before a boundary, but which is estimated to be in the next column.

    for (const [nbOfColumns, x] of [
      [9, 7 * (1 / 9)], // Boundary 7 (0.7777777777777777), which is estimated to be in column 6 rather than 7.
      [6, 0.49999999999999994] // Just before 0.5, which is estimated to be in column 3 rather than 2.
    ] as const) {
      const xValues = Float64Array.from([0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.45, x, 0.9, 0.95, 1, 1.1]);
      const yValues = Float64Array.from([5, 1, 7, 3, 9, 2, 8, 4, 6, 0, 5, 1]);
      const lod = levelOfDetail(xValues, yValues, 9);

      selectPoints(lod, xValues, yValues, 0, 9, 0, 1, nbOfColumns);

      // Our first changed point is the point before our last point, i.e. our special point.

      invalidate(lod, 8);
      update(lod, xValues, yValues, 12);

      const selection = selectPoints(lod, xValues, yValues, 0, 12, 0, 1, nbOfColumns);

      expect(selection?.firstChanged).toBeGreaterThan(0);
      expect(selectedIndices(selection)).toEqual(
        selectedIndices(selectPoints(levelOfDetail(xValues, yValues), xValues, yValues, 0, 12, 0, 1, nbOfColumns))
      );
      checkSelection(xValues, yValues, 0, 12, 0, 1, nbOfColumns, selection);
    }
  });
});
