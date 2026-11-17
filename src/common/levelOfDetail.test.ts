import { describe, expect, it } from 'bun:test';

import {
  create,
  type ILevelOfDetail,
  type ISelection,
  invalidate,
  selectPoints,
  update,
  visibleRange
} from './levelOfDetail';

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

const levelOfDetail = (
  xValues: Float64Array,
  yValues: Float64Array,
  count: number = xValues.length
): ILevelOfDetail => {
  // Return an up-to-date level of detail for the given points.

  const res = create();

  update(res, xValues, yValues, count);

  return res;
};

const selectedIndices = (selection: ISelection | undefined): number[] => {
  // Return the indices of the given selection.

  return selection ? Array.from(selection.indices.subarray(0, selection.nbOfPoints)) : [];
};

const checkSelection = (
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  xMin: number,
  xMax: number,
  nbOfColumns: number,
  selection: ISelection | undefined
): void => {
  // Check that the given selection is what we need to draw the given points for the given X range split into the given
  // number of columns, i.e. that, for each range of points (see selectPoints()), all of its points are selected if it
  // has up to four of them, or its first and last points, as well as points with its minimum and maximum Y values, and
  // no more than four points in total, otherwise.
  // Note: we determine our ranges of points in a brute-force way, i.e. without relying on levelOfDetail.ts.

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
      const boundary = k === nbOfColumns ? xMax : xMin + k * columnWidth;

      while (rangeEnd < end && (xValues[rangeEnd] as number) < boundary) {
        ++rangeEnd;
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
      const rangeYValues = Array.from(yValues.subarray(rangeStart, rangeEnd));
      const selectedYValues = rangeIndices.map((i) => yValues[i] as number);

      expect(rangeIndices.length).toBeLessThanOrEqual(4);
      expect(rangeIndices[0]).toBe(rangeStart);
      expect(rangeIndices.at(-1)).toBe(rangeEnd - 1);
      expect(rangeIndices).toEqual([...rangeIndices].sort((a, b) => a - b));
      expect(new Set(rangeIndices).size).toBe(rangeIndices.length);
      expect(Math.min(...selectedYValues)).toBe(Math.min(...rangeYValues));
      expect(Math.max(...selectedYValues)).toBe(Math.max(...rangeYValues));
    }

    rangeStart = rangeEnd;
  }

  // Make sure that all of our selected points were within our ranges.

  expect(index).toBe(indices.length);
};

const randomPoints = (random: () => number, nbOfPoints: number): [Float64Array, Float64Array] => {
  // Return some random points, with sorted X values (some of which are the same) and random Y values.

  const xValues = new Float64Array(nbOfPoints);
  const yValues = new Float64Array(nbOfPoints);
  let x = 0;

  for (let i = 0; i < nbOfPoints; ++i) {
    x += random() < 0.1 ? 0 : random();

    xValues[i] = x;
    yValues[i] = 1000 * (random() - 0.5);
  }

  return [xValues, yValues];
};

// create().

describe('create()', () => {
  it('creates an empty level of detail', () => {
    expect(create()).toEqual({ count: 0, sortedLength: 0, levels: [], selection: undefined });
  });
});

// update().

describe('update()', () => {
  const sortedLength = (xValues: number[]): number => {
    return levelOfDetail(Float64Array.from(xValues), new Float64Array(xValues.length)).sortedLength;
  };

  it('determines how many leading points have finite X values that are sorted', () => {
    expect(sortedLength([])).toBe(0);
    expect(sortedLength([1, 2, 2, 3])).toBe(4);
    expect(sortedLength([1, 3, 2, 4])).toBe(2);
    expect(sortedLength([1, Number.NaN, 3])).toBe(1);
    expect(sortedLength([Number.NEGATIVE_INFINITY, 1])).toBe(0);
    expect(sortedLength([1, Number.POSITIVE_INFINITY])).toBe(1);
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
  const xValues = Float64Array.from([0, 1, 2, 3, 4, 5]);

  it('returns the points within the given X range, as well as the points just before and after it', () => {
    expect(visibleRange(xValues, 6, 1.5, 3.5)).toEqual([1, 5]);
    expect(visibleRange(xValues, 6, 1, 3)).toEqual([0, 5]);
    expect(visibleRange(xValues, 6, 0, 5)).toEqual([0, 6]);
    expect(visibleRange(xValues, 6, -10, 10)).toEqual([0, 6]);
  });

  it('handles an X range that is before or after all the points', () => {
    expect(visibleRange(xValues, 6, -5, -1)).toEqual([0, 1]);
    expect(visibleRange(xValues, 6, 10, 20)).toEqual([5, 6]);
  });

  it('only considers the given number of points', () => {
    expect(visibleRange(xValues, 3, 0, 10)).toEqual([0, 3]);
  });

  it('handles points with the same X value', () => {
    expect(visibleRange(Float64Array.from([0, 1, 1, 1, 2]), 5, 1, 1)).toEqual([0, 5]);
  });
});

// selectPoints().

describe('selectPoints()', () => {
  it('selects the points needed to draw some points', () => {
    // Check our selection for different numbers of points (so that we have up to five levels of blocks), X ranges, and
    // numbers of columns.

    const random = randomGenerator(123);

    for (const nbOfPoints of [1, 5, 50, 1000, 5000, 70000]) {
      const [xValues, yValues] = randomPoints(random, nbOfPoints);
      const lod = levelOfDetail(xValues, yValues);
      const xLast = xValues[nbOfPoints - 1] as number;

      for (let run = 0; run < 20; ++run) {
        const xMin = xLast * (1.2 * random() - 0.1);
        const xMax = xMin + xLast * (0.01 + random());
        const nbOfColumns = 1 + Math.floor(300 * random());
        const [start, end] = visibleRange(xValues, nbOfPoints, xMin, xMax);
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
    const xValues = Float64Array.from({ length: 10 }, (_value, i) => i);
    const yValues = Float64Array.from([0, 1, 9, 2, 3, -9, 4, 5, 6, 7]);
    const select = (y: Float64Array): number[] => {
      return selectedIndices(selectPoints(levelOfDetail(xValues, y), xValues, y, 0, 10, 10, 20, 1));
    };

    // Note: our X range is after all of our points, so they are all in the same range.

    expect(select(yValues)).toEqual([0, 2, 5, 9]);

    // A minimum or maximum that is the first or last point of our range isn't selected twice.

    expect(select(Float64Array.from([-9, 1, 9, 2, 3, 0, 4, 5, 6, 7]))).toEqual([0, 2, 9]);
    expect(select(Float64Array.from([0, 1, 2, 2, 3, -9, 4, 5, 6, 9]))).toEqual([0, 5, 9]);
    expect(select(Float64Array.from([-9, 1, 2, 2, 3, 0, 4, 5, 6, 9]))).toEqual([0, 9]);
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

  it('fails if some of the points have a gap', () => {
    // A few points, i.e. that are not in any block.

    const fewXValues = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const fewYValues = Float64Array.from([0, 1, 2, Number.NaN, 4, 5, 6, 7, 8, 9]);
    const fewLod = levelOfDetail(fewXValues, fewYValues);

    expect(selectPoints(fewLod, fewXValues, fewYValues, 0, 10, 0, 9, 2)).toBeUndefined();
    expect(selectPoints(fewLod, fewXValues, fewYValues, 4, 10, 4, 9, 2)).toBeDefined();

    // Many points, i.e. that are in blocks.

    const nbOfPoints = 1000;
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i);
    const yValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => Math.sin(i));

    yValues[500] = Number.NaN;
    yValues[700] = Number.POSITIVE_INFINITY;

    const lod = levelOfDetail(xValues, yValues);

    expect(selectPoints(lod, xValues, yValues, 0, 500, 0, 500, 10)).toBeDefined();
    expect(lod.selection).toBeDefined();
    expect(selectPoints(lod, xValues, yValues, 0, nbOfPoints, 0, nbOfPoints, 10)).toBeUndefined();
    expect(lod.selection).toBeUndefined();
    expect(selectPoints(lod, xValues, yValues, 600, 800, 600, 800, 10)).toBeUndefined();
    expect(selectPoints(lod, xValues, yValues, 501, 700, 501, 700, 10)).toBeDefined();
  });

  it('selects the points of new data the same way, whether incrementally or from scratch', () => {
    // Simulate some live data, i.e. points that get appended to (by a random number of points at a time) and which last
    // point gets retrieved again (and may therefore change), and that are drawn for a fixed X range. At each step,
    // check that our selection is the same as the one we get from scratch, and that it reuses the points of our
    // previous selection that cannot have changed.

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

      if (count > 0 && random() < 0.5) {
        yValues[count - 1] = random();
      }

      for (let i = count; i < newCount; ++i) {
        xValues[i] = 0.1 * i;
        yValues[i] = random();
      }

      invalidate(lod, Math.max(0, count - 1));
      update(lod, xValues, yValues, newCount);

      count = newCount;

      const previousIndices = selectedIndices(lod.selection);
      const [start, end] = visibleRange(xValues, count, 0, X_MAX);
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
