import { describe, expect, it } from 'bun:test';

import {
  create,
  type IPathLevelOfDetail,
  invalidate,
  MAX_LEVEL_RATIO,
  MIN_NB_OF_POINTS_TO_DROP_LEVELS,
  memoryUsage,
  selectLevel,
  update,
  updatedLevel
} from './pathLevelOfDetailUtils';

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

const NB_OF_LEVELS = 11;

const updateLevels = (lod: IPathLevelOfDetail, xValues: Float64Array, yValues: Float64Array): void => {
  // Update all of the levels of the given level of detail (see Note #5 of pathLevelOfDetailUtils.ts).

  for (let level = 0; level < NB_OF_LEVELS; ++level) {
    updatedLevel(lod, xValues, yValues, level);
  }
};

const levelOfDetail = (
  xValues: Float64Array,
  yValues: Float64Array,
  count: number = xValues.length
): IPathLevelOfDetail => {
  // Return a level of detail for the given points, with all of its levels up to date.

  const res = create();

  update(res, xValues, yValues, count);
  updateLevels(res, xValues, yValues);

  return res;
};

const points = (values: [number, number][]): [Float64Array, Float64Array] => {
  return [Float64Array.from(values, ([x]) => x), Float64Array.from(values, ([, y]) => y)];
};

const levelIndices = (
  lod: IPathLevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  level: number
): number[] => {
  // Return the indices of the points of the given level, once up to date.

  const pathLevel = updatedLevel(lod, xValues, yValues, level);

  return pathLevel ? Array.from(pathLevel.indices.subarray(0, pathLevel.count)) : [];
};

const isFinitePoint = (xValues: Float64Array, yValues: Float64Array, index: number): boolean => {
  return Number.isFinite(xValues[index]) && Number.isFinite(yValues[index]);
};

const checkLevels = (lod: IPathLevelOfDetail, xValues: Float64Array, yValues: Float64Array, count: number): void => {
  // Check that each of our levels has the points that it should have (see Note #1 and Note #4 of
  // pathLevelOfDetailUtils.ts), i.e. that it starts with our first point and ends with our last point (or the first
  // point of our last gap), that it replaces each gap with its first point and has the points before and after it, and
  // that all of the points between two of its consecutive points are within its tolerance of the segment between them.

  let nbOfFinitePoints = 0;

  for (let i = 0; i < count; ++i) {
    if (isFinitePoint(xValues, yValues, i)) {
      ++nbOfFinitePoints;
    }
  }

  expect(lod.count).toBe(count);

  if (nbOfFinitePoints === 0) {
    expect(lod.levels).toEqual([]);
  }

  let lastPoint = count - 1;

  while (
    lastPoint > 0 &&
    !isFinitePoint(xValues, yValues, lastPoint) &&
    !isFinitePoint(xValues, yValues, lastPoint - 1)
  ) {
    --lastPoint;
  }

  updateLevels(lod, xValues, yValues);

  for (const pathLevel of lod.levels) {
    const indices = levelIndices(lod, xValues, yValues, pathLevel.level);
    const kept = new Set(indices);
    const scale = 2 ** pathLevel.level;
    const u = (index: number): number => (((xValues[index] as number) - lod.xOrigin) / lod.xSize) * scale;
    const v = (index: number): number => (((yValues[index] as number) - lod.yOrigin) / lod.ySize) * scale;

    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(lastPoint);

    for (let k = 1; k < indices.length; ++k) {
      expect((indices[k] as number) > (indices[k - 1] as number)).toBe(true);
    }

    for (let i = 0; i < count; ++i) {
      if (!isFinitePoint(xValues, yValues, i)) {
        // A gap is replaced with its first point, and the points before and after it are kept.

        const firstOfGap = i === 0 || isFinitePoint(xValues, yValues, i - 1);

        expect(kept.has(i)).toBe(firstOfGap);

        if (i > 0 && firstOfGap) {
          expect(kept.has(i - 1)).toBe(true);
        }

        if (i + 1 < count && isFinitePoint(xValues, yValues, i + 1)) {
          expect(kept.has(i + 1)).toBe(true);
        }
      }
    }

    for (let k = 1; k < indices.length; ++k) {
      const a = indices[k - 1] as number;
      const b = indices[k] as number;

      if (!isFinitePoint(xValues, yValues, a) || !isFinitePoint(xValues, yValues, b)) {
        continue;
      }

      const vx = u(b) - u(a);
      const vy = v(b) - v(a);
      const squaredLength = vx * vx + vy * vy;

      for (let i = a + 1; i < b; ++i) {
        const px = u(i) - u(a);
        const py = v(i) - v(a);
        const t = squaredLength > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / squaredLength)) : 0;

        expect(Math.hypot(px - t * vx, py - t * vy)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  }
};

const curve = (nbOfPoints: number, offset: number = 0): [Float64Array, Float64Array] => {
  // Return a Lissajous curve, i.e. a smooth trace which X values are not sorted, like a phase plot.

  return [
    Float64Array.from({ length: nbOfPoints }, (_value, i) => offset + Math.sin((60 * i) / nbOfPoints)),
    Float64Array.from({ length: nbOfPoints }, (_value, i) => Math.sin((80 * i) / nbOfPoints))
  ];
};

const randomWalk = (random: () => number, nbOfPoints: number, gaps: boolean): [Float64Array, Float64Array] => {
  // Return a random walk (i.e. a trace which X values are not sorted) which steps get bigger as it goes (so that its
  // range grows and our levels get rebuilt), with some isolated gaps and runs of gaps, if requested.

  const xValues = new Float64Array(nbOfPoints);
  const yValues = new Float64Array(nbOfPoints);
  let x = 0;
  let y = 0;
  let gapLength = 0;

  for (let i = 0; i < nbOfPoints; ++i) {
    const step = 0.001 * (1 + i / 100);

    x += step * (random() - 0.5);
    y += step * (random() - 0.5);

    xValues[i] = x;
    yValues[i] = y;

    if (gaps) {
      if (gapLength === 0 && random() < 0.005) {
        gapLength = 1 + Math.floor(20 * random());
      }

      if (gapLength > 0) {
        --gapLength;

        if (random() < 0.5) {
          xValues[i] = Number.NaN;
        } else {
          yValues[i] = Number.POSITIVE_INFINITY;
        }
      } else if (random() < 0.01) {
        xValues[i] = Number.NaN;
      }
    }
  }

  return [xValues, yValues];
};

const processIncrementally = (
  random: () => number,
  lod: IPathLevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  check: boolean
): Set<number> => {
  // Process the given points bit by bit, like a simulation would, i.e. with its last point changing every time (it gets
  // retrieved again), checking our levels every time, if requested, and return the X sizes that we had.

  const nbOfPoints = xValues.length;
  const res = new Set<number>();
  let count = 0;

  while (count < nbOfPoints) {
    const newCount = Math.min(nbOfPoints, count + 1 + Math.floor(300 * random()));

    if (count > 0) {
      // Change our last point, and then put it back, so that our level of detail must update it.

      const lastY = yValues[count - 1] as number;

      yValues[count - 1] = lastY + 0.001;

      invalidate(lod, count - 1);
      update(lod, xValues, yValues, count);

      yValues[count - 1] = lastY;

      invalidate(lod, count - 1);
    }

    update(lod, xValues, yValues, newCount);
    updateLevels(lod, xValues, yValues);

    res.add(lod.xSize);

    count = newCount;

    if (check) {
      checkLevels(lod, xValues, yValues, count);
    }
  }

  return res;
};

// create() and memoryUsage().

describe('create() and memoryUsage()', () => {
  it('creates an empty level of detail', () => {
    const lod = create();

    expect(lod.count).toBe(0);
    expect(lod.xSize).toBe(0);
    expect(lod.levels).toEqual([]);
    expect(memoryUsage(lod)).toBe(0);
  });

  it('returns the memory used by its levels', () => {
    const [xValues, yValues] = curve(1000);
    const lod = levelOfDetail(xValues, yValues);

    expect(memoryUsage(lod)).toBe(lod.levels.reduce((sum, level) => sum + level.indices.byteLength, 0));
    expect(memoryUsage(lod)).toBeGreaterThan(0);
  });
});

// update().

describe('update()', () => {
  it('replaces consecutive points with a segment if they are within its tolerance of it', () => {
    // Our X size is 1 and our Y size is 2^-6 (i.e. the smallest power of two that is at least 0.01), so our middle
    // point is 0.64 tolerances away from the segment between our first and last points at level 0, and 2.56 tolerances
    // away at level 1 (since our tolerances get four times smaller from one level to the next).

    const [xValues, yValues] = points([
      [0, 0],
      [0.5, 0.01],
      [1, 0]
    ]);
    const lod = levelOfDetail(xValues, yValues);

    expect([lod.xOrigin, lod.yOrigin, lod.xSize, lod.ySize]).toEqual([0, 0, 1, 2 ** -6]);
    expect(levelIndices(lod, xValues, yValues, 0)).toEqual([0, 2]);
    expect(levelIndices(lod, xValues, yValues, 1)).toEqual([0, 1, 2]);
    expect(lod.levels.length).toBe(11);

    checkLevels(lod, xValues, yValues, xValues.length);
  });

  it('greatly reduces the number of points of a smooth trace', () => {
    const [xValues, yValues] = curve(100000);
    const lod = levelOfDetail(xValues, yValues);

    // Level 5 has tolerances of 2^-10 times our sizes, i.e. about a third of a pixel for a plot that is about 700
    // pixels wide and high.

    expect(levelIndices(lod, xValues, yValues, 5).length).toBeLessThan(2000);

    checkLevels(lod, xValues, yValues, xValues.length);
  });

  it('ends a segment at a gap and replaces consecutive gaps with the first of them', () => {
    const [xValues, yValues] = points([
      [Number.NaN, 0],
      [0, 0],
      [0.5, 0],
      [Number.NaN, 0],
      [0, Number.NaN],
      [0.75, 0],
      [1, 0],
      [Number.POSITIVE_INFINITY, 0],
      [0.5, 0.5],
      [Number.NaN, Number.NaN]
    ]);
    const lod = levelOfDetail(xValues, yValues);

    expect(levelIndices(lod, xValues, yValues, 0)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9]);

    checkLevels(lod, xValues, yValues, xValues.length);
  });

  it('keeps the precision of values with a large offset', () => {
    const [xValues, yValues] = curve(10000, 1e9);
    const lod = levelOfDetail(xValues, yValues);

    expect(lod.xOrigin).toBe(1e9);
    expect(levelIndices(lod, xValues, yValues, 5).length).toBeLessThan(1000);

    checkLevels(lod, xValues, yValues, xValues.length);
  });

  it('has sizes that are big enough for values that are all the same and for a range that Math.log2() rounds down', () => {
    for (const [x, y] of [
      [-5, 7],
      [0, 0]
    ] as [number, number][]) {
      const [xValues, yValues] = points([
        [x, y],
        [x, y]
      ]);
      const lod = levelOfDetail(xValues, yValues);

      expect(lod.xSize).toBeGreaterThan(0);
      expect(lod.ySize).toBeGreaterThan(0);

      checkLevels(lod, xValues, yValues, xValues.length);
    }

    const range = 2 ** -60 * (1 + 2 ** -52);
    const [xValues, yValues] = points([
      [0, 0],
      [range, 1]
    ]);

    expect(2 ** Math.ceil(Math.log2(range))).toBeLessThan(range);
    expect(levelOfDetail(xValues, yValues).xSize).toBe(2 ** -59);
  });

  it('has no sizes and no levels if it has no finite points', () => {
    const [xValues, yValues] = points([
      [Number.NaN, 0],
      [0, Number.NaN]
    ]);
    const lod = levelOfDetail(xValues, yValues);

    expect(lod.count).toBe(2);
    expect(lod.xSize).toBe(0);
    expect(lod.levels).toEqual([]);
    expect(selectLevel(lod, xValues, yValues, 1, 1)).toBeUndefined();
  });

  it('processes new points incrementally, rebuilding its levels when needed', () => {
    const random = randomGenerator(456);

    for (const gaps of [false, true]) {
      const [xValues, yValues] = randomWalk(random, 10000, gaps);
      const xSizes = processIncrementally(random, create(), xValues, yValues, true);

      expect(xSizes.size).toBeGreaterThan(2);
    }
  });

  it('starts again from scratch if its points are not a continuation of the ones it was last updated with', () => {
    // A path level of detail may be shared, so it may get updated with some values (e.g., by one of its users), then
    // with other values (e.g., by another of its users), and then with a continuation of the first values (e.g., by the
    // first user again), in which case it must not keep what it did for the other values (see Note #8 of
    // pathLevelOfDetailUtils.ts).

    const random = randomGenerator(852);
    const [xBuffer, yBuffer] = randomWalk(random, 3000, true);
    const [otherXValues, otherYValues] = randomWalk(random, 3000, true);
    const xValues = xBuffer.subarray(0, 3000);
    const yValues = yBuffer.subarray(0, 3000);
    const lod = create();

    update(lod, xBuffer.subarray(0, 2000), yBuffer.subarray(0, 2000), 2000);
    updateLevels(lod, xBuffer.subarray(0, 2000), yBuffer.subarray(0, 2000));
    update(lod, otherXValues, otherYValues, 3000);
    updateLevels(lod, otherXValues, otherYValues);
    update(lod, xValues, yValues, 3000);

    checkLevels(lod, xValues, yValues, 3000);

    const freshLod = levelOfDetail(xValues, yValues);

    expect([lod.xSize, lod.ySize]).toEqual([freshLod.xSize, freshLod.ySize]);

    for (const pathLevel of freshLod.levels) {
      expect(levelIndices(lod, xValues, yValues, pathLevel.level)).toEqual(
        levelIndices(freshLod, xValues, yValues, pathLevel.level)
      );
    }

    // The very same values are assumed not to have changed, so nothing gets taken into account again.

    const version = lod.version;

    update(lod, xValues, yValues, 3000);

    expect(lod.version).toBe(version);
  });

  it('gets the same levels whether it processes its points incrementally or in one go', () => {
    // Some points which range is that of their first points, so that our sizes are the same either way (see Note #6 of
    // pathLevelOfDetailUtils.ts).

    const random = randomGenerator(654);

    for (const gaps of [false, true]) {
      const [xValues, yValues] = randomWalk(random, 5000, gaps);

      xValues[0] = -10;
      yValues[0] = -10;
      xValues[1] = 10;
      yValues[1] = 10;

      const lod = create();

      processIncrementally(random, lod, xValues, yValues, false);

      const freshLod = levelOfDetail(xValues, yValues);

      expect(lod.levels.length).toBe(freshLod.levels.length);

      for (const pathLevel of lod.levels) {
        expect(levelIndices(lod, xValues, yValues, pathLevel.level)).toEqual(
          levelIndices(freshLod, xValues, yValues, pathLevel.level)
        );
      }
    }
  });

  it('does nothing if it has already processed the given points', () => {
    const [xValues, yValues] = curve(100);
    const lod = levelOfDetail(xValues, yValues);
    const levels = lod.levels;

    update(lod, xValues, yValues, 50);

    expect(lod.count).toBe(100);
    expect(lod.levels).toBe(levels);
  });

  it('drops its finest levels if they hardly reduce its number of points', () => {
    // Some noisy points along a line, so that only our coarsest levels (which tolerances are bigger than our noise)
    // reduce our number of points.

    const random = randomGenerator(321);
    const nbOfPoints = MIN_NB_OF_POINTS_TO_DROP_LEVELS;
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i / nbOfPoints);
    const yValues = Float64Array.from({ length: nbOfPoints }, () => 0.001 * random());
    const lod = levelOfDetail(xValues, yValues, nbOfPoints - 1);

    // We don't drop any level until we have enough points.

    expect(lod.levels.length).toBe(11);

    // Now that we have enough points, we drop our finest levels, but only once they get updated (see Note #5 and Note
    // #7 of pathLevelOfDetailUtils.ts).

    update(lod, xValues, yValues, nbOfPoints);

    expect(lod.levels.length).toBe(11);

    updateLevels(lod, xValues, yValues);

    expect(lod.levels.length).toBeGreaterThan(0);
    expect(lod.levels.length).toBeLessThan(11);
    expect((lod.levels.at(-1)?.count ?? 0) <= MAX_LEVEL_RATIO * nbOfPoints).toBe(true);

    checkLevels(lod, xValues, yValues, nbOfPoints);
  });

  it('only updates a level when it is needed, catching up from where it was', () => {
    // Process some points bit by bit, like a simulation would (see processIncrementally()), but only update some of our
    // levels: level 2 every time, level 4 every fifth time, and level 6 only at the end. Each of them should then be
    // the same as if we processed our points in one go (their range is that of their first points, so that our sizes
    // are the same either way).

    const random = randomGenerator(246);
    const [xValues, yValues] = randomWalk(random, 3000, true);

    xValues[0] = -10;
    yValues[0] = -10;
    xValues[1] = 10;
    yValues[1] = 10;

    const lod = create();
    let count = 0;
    let step = 0;

    while (count < xValues.length) {
      const newCount = Math.min(xValues.length, count + 1 + Math.floor(100 * random()));

      invalidate(lod, Math.max(1, count - 1));
      update(lod, xValues, yValues, newCount);

      updatedLevel(lod, xValues, yValues, 2);

      if (++step % 5 === 0) {
        updatedLevel(lod, xValues, yValues, 4);
      }

      count = newCount;
    }

    // Our other levels haven't processed any point.

    expect(lod.levels.map((level) => level.processedCount > 0)).toEqual(
      Array.from({ length: NB_OF_LEVELS }, (_value, level) => level === 2 || level === 4)
    );

    const freshLod = levelOfDetail(xValues, yValues);

    for (const level of [2, 4, 6]) {
      expect(levelIndices(lod, xValues, yValues, level)).toEqual(levelIndices(freshLod, xValues, yValues, level));
    }
  });
});

// invalidate().

describe('invalidate()', () => {
  it('only keeps the points before the given one', () => {
    const [xValues, yValues] = curve(100);
    const lod = levelOfDetail(xValues, yValues);

    invalidate(lod, 150);

    expect(lod.count).toBe(100);

    invalidate(lod, 40);

    expect(lod.count).toBe(40);

    update(lod, xValues, yValues, 100);

    checkLevels(lod, xValues, yValues, 100);
  });

  it('gets the same levels as in one go when updating from any point (e.g., not just from its last point)', () => {
    // Some points with gaps, which we invalidate from every point (including just after a gap, and in a gap), so that
    // our levels need to be reopened rather than restored from their snapshot (see Note #5 of
    // pathLevelOfDetailUtils.ts).

    const random = randomGenerator(135);
    const [xValues, yValues] = randomWalk(random, 300, true);
    const freshLod = levelOfDetail(xValues, yValues);

    for (let from = 1; from < xValues.length; ++from) {
      const lod = levelOfDetail(xValues, yValues);

      invalidate(lod, from);
      update(lod, xValues, yValues, xValues.length);

      for (const pathLevel of freshLod.levels) {
        expect(levelIndices(lod, xValues, yValues, pathLevel.level)).toEqual(
          levelIndices(freshLod, xValues, yValues, pathLevel.level)
        );
      }
    }
  });

  it('resets itself if all of its points may have changed', () => {
    const [xValues, yValues] = curve(100);
    const lod = levelOfDetail(xValues, yValues);
    const version = lod.version;

    invalidate(lod, 0);

    expect({ ...lod, version: 0, xValues: undefined, yValues: undefined } as IPathLevelOfDetail).toEqual(create());
    expect(lod.version).toBeGreaterThan(version);

    // So, it doesn't keep any of its previous points if it now has no points.

    update(lod, xValues, yValues, 0);

    expect(lod.levels).toEqual([]);
  });
});

// version.

describe('version', () => {
  it('changes whenever its levels may have changed, and only then', () => {
    const [xValues, yValues] = curve(100);
    const lod = create();
    let version = lod.version;

    const versionChanged = (): boolean => {
      const res = lod.version !== version;

      version = lod.version;

      return res;
    };

    // When we process new points, but not if we have already processed them.

    update(lod, xValues, yValues, 50);

    expect(versionChanged()).toBe(true);

    update(lod, xValues, yValues, 50);

    expect(versionChanged()).toBe(false);

    // When we process points again, even the same ones.

    invalidate(lod, 49);
    update(lod, xValues, yValues, 50);

    expect(versionChanged()).toBe(true);

    // When we get reset, even if we then process the same points (since our levels may be different, e.g. if our sizes
    // end up being different).

    invalidate(lod, 0);

    expect(versionChanged()).toBe(true);

    update(lod, xValues, yValues, 50);

    expect(versionChanged()).toBe(true);

    // When our levels get rebuilt.

    xValues[60] = 100;

    update(lod, xValues, yValues, 100);

    expect(versionChanged()).toBe(true);
  });
});

// selectLevel().

describe('selectLevel()', () => {
  const [xValues, yValues] = points([
    [0, 0],
    [0.5, 4],
    [1, 8]
  ]);

  it('returns its coarsest level which tolerances are no bigger than the given ones', () => {
    // Our sizes are 1 and 8, i.e. level k has tolerances of 1 / 4^k and 8 / 4^k.

    const lod = levelOfDetail(xValues, yValues);

    expect(selectLevel(lod, xValues, yValues, 1, 8)?.level).toBe(0);
    expect(selectLevel(lod, xValues, yValues, 5, 50)?.level).toBe(0);
    expect(selectLevel(lod, xValues, yValues, 0.3, 8)?.level).toBe(1);
    expect(selectLevel(lod, xValues, yValues, 1, 0.5)?.level).toBe(2);
    expect(selectLevel(lod, xValues, yValues, 0.3, 0.5)?.level).toBe(2);
    expect(selectLevel(lod, xValues, yValues, 2 ** -20, 8)?.level).toBe(10);
  });

  it('returns nothing if its tolerances are not small enough or if the given tolerances are not valid', () => {
    const lod = levelOfDetail(xValues, yValues);

    expect(selectLevel(lod, xValues, yValues, 2 ** -21, 8)).toBeUndefined();
    expect(selectLevel(lod, xValues, yValues, 0, 1)).toBeUndefined();
    expect(selectLevel(lod, xValues, yValues, 1, Number.NaN)).toBeUndefined();
    expect(selectLevel(create(), xValues, yValues, 1, 1)).toBeUndefined();

    // Nor if the level that we would need has been dropped.

    lod.levels.length = 2;

    expect(selectLevel(lod, xValues, yValues, 0.25, 8)?.level).toBe(1);
    expect(selectLevel(lod, xValues, yValues, 0.2, 8)).toBeUndefined();
  });
});
