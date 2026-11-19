// The path level of detail of a trace, i.e. the points of a trace that we need to draw so that it looks the same (give
// or take a fraction of a pixel) as if all of its points were drawn, whether or not its X values are sorted (e.g., a
// phase plot). This complements our (column) level of detail (see levelOfDetailUtils.ts), which is exact, but which
// requires sorted X values.
// Note #1: we simplify our path at different levels: level k has a tolerance of XSize / 4^k along the X axis and of
//          YSize / 4^k along the Y axis, where XSize (and YSize) is the smallest power of two that is at least as big
//          as the range of our X (and Y) values. (Our tolerances get four, rather than two, times smaller from one
//          level to the next, so that we have half as many levels to build, at the cost of using a level that has up to
//          four, rather than two, times smaller tolerances than needed, i.e. up to about two, rather than one and a
//          half, times as many points as needed for a smooth trace.) For each level, consecutive points are replaced
//          with a segment, from the first to the last of them, as long as all of them are within our tolerance of that
//          segment, i.e. within a distance of one once their X and Y values are divided by our X and Y tolerances. So,
//          if the tolerances of a level are smaller than a fraction of a pixel, then what gets drawn using that level
//          is within that fraction of a pixel (times the square root of two, if both tolerances are that fraction of a
//          pixel) of what would otherwise get drawn, while the number of points to go through (and to draw) is about
//          the number of segments that are needed to draw our trace within that fraction of a pixel, which is much
//          smaller than its number of points for a smooth trace (e.g., about 1,000 rather than 1,000,000 for a
//          Lissajous curve).
// Note #2: our segments are found in one pass, from an anchor point (i.e. the first point of our trace, the first point
//          after a gap, or the last point of our previous segment): a point can be the end of our current segment if
//          its direction (from our anchor) is within the directions that keep our previous points within our tolerance
//          (i.e. our cone, see Note #3) and if it is at least as far from our anchor as our previous points that are
//          further than our tolerance from our anchor (so that none of them is beyond it), or if it is within our
//          tolerance of our anchor and so are our previous points (since a point within our tolerance of our anchor is
//          within our tolerance of any segment from our anchor). Otherwise, our previous point becomes the end of our
//          current segment and the anchor of our next segment. This means that a point (other than an anchor after a
//          gap) only becomes one of our points because of the point that follows it (see Note #5).
// Note #3: our cone is the intersection of the directions that keep each of our points (that is further than our
//          tolerance from our anchor) within our tolerance of our segment, i.e. the directions within asin(1 / d) of
//          the direction of a point at a distance d. Since each of those is less than half a turn wide, so is our cone,
//          which we keep as its two boundary directions, so that we can check whether a direction is within it using
//          cross products (i.e. without any trigonometry).
// Note #4: a gap (i.e. a point with a non-finite X or Y value) ends our current segment, and consecutive gaps are
//          replaced with the first of them, so that a gap in the data is drawn as a gap in the trace.
// Note #5: our levels are only updated when they are needed (see updatedLevel()), i.e. normally the one level that is
//          needed to draw our trace, so that we don't spend time updating levels that are not needed (e.g., while a
//          simulation is running, when our trace gets updated and drawn many times a second). Also, like our (column)
//          level of detail, a level is kept up to date incrementally, i.e. if only the last point onwards of a trace
//          may have changed (e.g., while a simulation is running), then we remove the points of the level from the
//          point before it (since it might have become one of its points because of it, see Note #2), and we resume
//          from the last point that we keep (as an anchor). However, our segments can be long (e.g., for our coarsest
//          levels), so resuming from our anchor would mean going through many points again. So, a level also keeps a
//          snapshot of its state just before our last point (since it is normally the first point that may have
//          changed), from which it resumes if it can. This means that updating a level with N new points costs O(N)
//          rather than O(size of the trace), while the first update of a level (e.g., once zoomed in) costs O(size of
//          the trace).
// Note #6: our values are relative to an origin (i.e. the first finite point of our trace), so that they keep as much
//          precision as possible (e.g., if they have a large offset). If the range of our values gets bigger than our
//          sizes (e.g., while a simulation is running), then we rebuild our levels for all of our points, which only
//          happens a few times since our sizes are powers of two (e.g., when the range of our values doubles).
// Note #7: a level that hardly reduces the number of points of a trace (e.g., a fine level for a trace with fewer
//          points than segments to draw, or for noisy data) would only use memory, so once a trace has at least
//          MIN_NB_OF_POINTS_TO_DROP_LEVELS points, we drop a level that has more than MAX_LEVEL_RATIO times its number
//          of points when we update it, as well as our finer levels (since our levels have more and more points as they
//          get finer). This means that our levels use, at most, about as much memory as the indices of the points of
//          our trace. A dropped level only comes back if our levels get rebuilt (see Note #6).
// Note #8: like our (column) level of detail (see Note #9 of levelOfDetailUtils.ts), we keep track of the X and Y
//          values that we were last updated with, so that when we get updated with some values that are not a
//          continuation of them (see traceValues.ts), we start again from scratch, and otherwise only from our last
//          point (which may have changed), unless they are the very same values (i.e. the same arrays), which we assume
//          haven't changed, since we may be shared (e.g., by the two renderers of a plot).

import { isContinuationOf } from './traceValues';

const NB_OF_LEVELS = 11; // Number of levels, i.e. from tolerances of XSize and YSize to tolerances 4^10 times smaller.
const MIN_SIZE_RATIO = 2 ** -40; // Minimum size relative to our values (e.g., if they are all the same).
const MIN_SIZE = 2 ** -1000; // Minimum size (e.g., if all of our values are zero).

export const MIN_NB_OF_POINTS_TO_DROP_LEVELS = 16384;
export const MAX_LEVEL_RATIO = 0.5;

// The state of a level while it processes our points (see processLevel()).

const STATE_NONE = 0; // We have nothing in progress, i.e. we are at the start of our trace or after a gap.
const STATE_GAP = 1; // We are in a gap.
const STATE_SEGMENT = 2; // We have a segment in progress, from an anchor.

export interface PathLevelState {
  state: number;
  anchor: number; // Index of our anchor.
  anchorU: number; // Position of our anchor, relative to our origin and divided by our sizes.
  anchorV: number;
  last: number; // Index of the last point that can be the end of our segment.
  maxSquaredDistance: number; // Max squared distance from our anchor (in tolerances) of our points beyond tolerance.
  fullCone: boolean; // Whether our cone allows all directions (i.e. no point constrains it yet).
  rightX: number; // Right (i.e. clockwise) boundary of our cone.
  rightY: number;
  leftX: number; // Left (i.e. counterclockwise) boundary of our cone.
  leftY: number;
}

const newState = (): PathLevelState => {
  return {
    state: STATE_NONE,
    anchor: -1,
    anchorU: 0,
    anchorV: 0,
    last: -1,
    maxSquaredDistance: 0,
    fullCone: true,
    rightX: 0,
    rightY: 0,
    leftX: 0,
    leftY: 0
  };
};

export interface PathLevel {
  indices: Int32Array; // Index of our points, i.e. the ends of our segments and the first of our gaps.
  count: number; // Number of our points.
  level: number; // Our level, i.e. our tolerances are XSize / 4^level and YSize / 4^level.
  openEnd: boolean; // Whether our last point is the end of a segment that may still be extended (see reopenLevel()).
  processedCount: number; // Number of points of our trace that we have processed.
  snapshotIndex: number; // Index of the point just before which we took our snapshot, or -1 if we don't have any.
  snapshotState: PathLevelState; // Our state just before that point (see Note #5 above).
  snapshotCount: number; // Our number of points just before that point.
}

export interface PathLevelOfDetail {
  count: number; // Number of points that we have taken into account (see update()).
  xOrigin: number; // Origin of our values (see Note #6 above).
  yOrigin: number;
  xSize: number; // Our sizes (see Note #1 above), or 0 if we don't have any (i.e. no finite point).
  ySize: number;
  xMin: number; // Range of the values of the points that we have taken into account.
  xMax: number;
  yMin: number;
  yMax: number;
  levels: PathLevel[]; // Our levels, from the coarsest one (i.e. level 0) to the finest one that we have kept.
  version: number; // Incremented whenever our levels may have changed (e.g., so that a consumer can cache them).
  xValues: Float64Array | undefined; // X values that we were last updated with (see Note #8 above).
  yValues: Float64Array | undefined; // Y values that we were last updated with.
}

export const create = (): PathLevelOfDetail => {
  return {
    count: 0,
    xOrigin: 0,
    yOrigin: 0,
    xSize: 0,
    ySize: 0,
    xMin: Number.POSITIVE_INFINITY,
    xMax: Number.NEGATIVE_INFINITY,
    yMin: Number.POSITIVE_INFINITY,
    yMax: Number.NEGATIVE_INFINITY,
    levels: [],
    version: 0,
    xValues: undefined,
    yValues: undefined
  };
};

export const memoryUsage = (lod: PathLevelOfDetail): number => {
  // Return the number of bytes used by the given level of detail, i.e. by its levels.

  let res = 0;

  for (const level of lod.levels) {
    res += level.indices.byteLength;
  }

  return res;
};

const reset = (lod: PathLevelOfDetail): void => {
  // Reset the given level of detail, keeping track of the fact that its levels may have changed, and of the values that
  // it was last updated with (since it gets reset while being updated, see update()).

  const { version, xValues, yValues } = lod;

  Object.assign(lod, create());

  lod.version = version + 1;
  lod.xValues = xValues;
  lod.yValues = yValues;
};

export const invalidate = (lod: PathLevelOfDetail, from: number): void => {
  // Invalidate the given level of detail from the given point onwards (i.e. those points may have changed), resetting
  // it if all of its points may have changed (so that we get new sizes and that our levels don't keep any of our
  // previous points, e.g. if we now have no points).

  if (from <= 0) {
    reset(lod);
  } else {
    lod.count = Math.min(lod.count, from);

    for (const level of lod.levels) {
      level.processedCount = Math.min(level.processedCount, from);
    }
  }
};

const size = (min: number, max: number): number => {
  // Return the smallest power of two that is at least as big as the given range (see Note #1 above).

  const range = Math.max(max - min, Math.abs(min) * MIN_SIZE_RATIO, Math.abs(max) * MIN_SIZE_RATIO, MIN_SIZE);
  let res = 2 ** Math.ceil(Math.log2(range));

  // Make sure that our size is big enough, in case Math.log2() rounded our range down.

  while (res < range) {
    res *= 2;
  }

  return res;
};

const rebuild = (lod: PathLevelOfDetail, xValues: Float64Array, yValues: Float64Array, count: number): void => {
  // Rebuild our sizes for the given points, and reset our levels (see Note #6 above).

  reset(lod);

  let hasFinitePoint = false;

  for (let i = 0; i < count; ++i) {
    const x = xValues[i] as number;
    const y = yValues[i] as number;

    if (x - x === 0 && y - y === 0) {
      if (!hasFinitePoint) {
        hasFinitePoint = true;

        lod.xOrigin = x;
        lod.yOrigin = y;
      }

      lod.xMin = Math.min(lod.xMin, x);
      lod.xMax = Math.max(lod.xMax, x);
      lod.yMin = Math.min(lod.yMin, y);
      lod.yMax = Math.max(lod.yMax, y);
    }
  }

  if (!hasFinitePoint) {
    return;
  }

  lod.xSize = size(lod.xMin, lod.xMax);
  lod.ySize = size(lod.yMin, lod.yMax);

  for (let level = 0; level < NB_OF_LEVELS; ++level) {
    lod.levels.push({
      indices: new Int32Array(64),
      count: 0,
      level,
      openEnd: false,
      processedCount: 0,
      snapshotIndex: -1,
      snapshotState: newState(),
      snapshotCount: 0
    });
  }
};

const isGap = (xValues: Float64Array, yValues: Float64Array, index: number): boolean => {
  // Return whether the given point is a gap, i.e. whether its X or Y value is not finite.
  // Note: we use x - x !== 0 to check whether x is not finite since it is faster than !Number.isFinite().

  const x = xValues[index] as number;
  const y = yValues[index] as number;

  return x - x !== 0 || y - y !== 0;
};

const reopenLevel = (level: PathLevel, xValues: Float64Array, yValues: Float64Array, from: number): number => {
  // Remove the points of the given level that may change because of the given point onwards (see Note #5 above), i.e.
  // its open end, if any, and its points from the point before the given one onwards, as well as its last gap, if it
  // ends with one (so that consecutive gaps still get replaced with the first of them), and return the index of the
  // last point that we keep, i.e. the anchor from which to resume, or -1 if we don't keep any point.
  // Note: the point before a gap is always one of our points (see processLevel()), so if we remove our last gap, then
  //       the last point that we keep is not a gap.

  if (level.openEnd) {
    --level.count;

    level.openEnd = false;
  }

  const indices = level.indices;
  let count = level.count;

  while (count > 0 && (indices[count - 1] as number) >= from - 1) {
    --count;
  }

  if (count > 0 && isGap(xValues, yValues, indices[count - 1] as number)) {
    --count;
  }

  level.count = count;

  return count > 0 ? (indices[count - 1] as number) : -1;
};

const appendIndex = (level: PathLevel, index: number): void => {
  // Append the given index to the given level, making sure that it has room for it.

  if (level.count === level.indices.length) {
    const indices = new Int32Array(2 * level.indices.length);

    indices.set(level.indices);

    level.indices = indices;
  }

  level.indices[level.count++] = index;
};

const startSegment = (state: PathLevelState, anchor: number, anchorU: number, anchorV: number): void => {
  state.state = STATE_SEGMENT;
  state.anchor = anchor;
  state.anchorU = anchorU;
  state.anchorV = anchorV;
  state.last = anchor;
  state.maxSquaredDistance = 0;
  state.fullCone = true;
};

export const update = (lod: PathLevelOfDetail, xValues: Float64Array, yValues: Float64Array, count: number): void => {
  // Take the given points into account, from the first one that may have changed since we were last updated (see Note
  // #8 above), or that we haven't taken into account (see invalidate()), i.e. make sure that our sizes are big enough
  // for them, and rebuild our levels otherwise (see Note #6 above).
  // Note: our levels themselves only get updated when they are needed (see Note #5 above and updatedLevel()).

  if (xValues !== lod.xValues || yValues !== lod.yValues) {
    invalidate(
      lod,
      isContinuationOf(xValues, lod.xValues) && isContinuationOf(yValues, lod.yValues) ? lod.count - 1 : 0
    );
  }

  lod.xValues = xValues;
  lod.yValues = yValues;

  if (lod.count >= count) {
    return;
  }

  ++lod.version;

  if (lod.xSize === 0) {
    rebuild(lod, xValues, yValues, count);
  } else {
    let { xMin, xMax, yMin, yMax } = lod;

    for (let i = lod.count; i < count; ++i) {
      const x = xValues[i] as number;
      const y = yValues[i] as number;

      if (x - x === 0 && y - y === 0) {
        if (x < xMin) {
          xMin = x;
        }

        if (x > xMax) {
          xMax = x;
        }

        if (y < yMin) {
          yMin = y;
        }

        if (y > yMax) {
          yMax = y;
        }
      }
    }

    if (xMax - xMin > lod.xSize || yMax - yMin > lod.ySize) {
      rebuild(lod, xValues, yValues, count);
    } else {
      lod.xMin = xMin;
      lod.xMax = xMax;
      lod.yMin = yMin;
      lod.yMax = yMax;
    }
  }

  lod.count = count;
};

const processLevel = (lod: PathLevelOfDetail, level: PathLevel, xValues: Float64Array, yValues: Float64Array): void => {
  // Process the points of our trace that the given level hasn't processed (see Note #5 above).

  const count = lod.count;
  const xOrigin = lod.xOrigin;
  const yOrigin = lod.yOrigin;
  const xSize = lod.xSize;
  const ySize = lod.ySize;
  const scale = 4 ** level.level;
  let state: PathLevelState;
  let start: number;

  // Reopen our level, i.e. restore its snapshot if we can, or remove its points that may change otherwise.

  if (level.snapshotIndex !== -1 && level.processedCount >= level.snapshotIndex) {
    level.count = level.snapshotCount;
    level.openEnd = false;

    state = { ...level.snapshotState };
    start = level.snapshotIndex;
  } else {
    const anchor = reopenLevel(level, xValues, yValues, level.processedCount);

    state = newState();

    if (anchor !== -1) {
      startSegment(
        state,
        anchor,
        ((xValues[anchor] as number) - xOrigin) / xSize,
        ((yValues[anchor] as number) - yOrigin) / ySize
      );
    }

    start = anchor + 1;
  }

  // Process our points.

  for (let i = start; i < count; ++i) {
    // Take a snapshot of our level just before our last point.

    if (i === count - 1) {
      level.snapshotIndex = i;
      level.snapshotState = { ...state };
      level.snapshotCount = level.count;
    }

    const x = xValues[i] as number;
    const y = yValues[i] as number;

    if (x - x !== 0 || y - y !== 0) {
      // A gap ends our segment, if any, and consecutive gaps are replaced with the first of them (see Note #4 above).

      if (state.state === STATE_SEGMENT && state.last !== state.anchor) {
        appendIndex(level, state.last);
      }

      if (state.state !== STATE_GAP) {
        appendIndex(level, i);

        state.state = STATE_GAP;
      }

      continue;
    }

    const u = (x - xOrigin) / xSize;
    const v = (y - yOrigin) / ySize;

    if (state.state !== STATE_SEGMENT) {
      // Our point is the first point of our trace or the first point after a gap, so it is our anchor.

      appendIndex(level, i);
      startSegment(state, i, u, v);

      continue;
    }

    // Check whether our point can be the end of our segment (see Note #2 and Note #3 above).

    let dx = (u - state.anchorU) * scale;
    let dy = (v - state.anchorV) * scale;
    let squaredDistance = dx * dx + dy * dy;

    if (!isSegmentEnd(state, dx, dy, squaredDistance)) {
      // Our previous point becomes the end of our segment and the anchor of our next segment, which our point is then
      // always the end of (since our cone allows all directions and nothing is further than our point).

      appendIndex(level, state.last);
      startSegment(
        state,
        state.last,
        ((xValues[state.last] as number) - xOrigin) / xSize,
        ((yValues[state.last] as number) - yOrigin) / ySize
      );

      dx = (u - state.anchorU) * scale;
      dy = (v - state.anchorV) * scale;
      squaredDistance = dx * dx + dy * dy;
    }

    extendSegment(state, i, dx, dy, squaredDistance);
  }

  // Add the end of our segment, if any, as an open end (since it may still be extended, see reopenLevel()).

  if (state.state === STATE_SEGMENT && state.last !== state.anchor) {
    appendIndex(level, state.last);

    level.openEnd = true;
  }

  level.processedCount = count;
};

export const updatedLevel = (
  lod: PathLevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  levelNumber: number
): PathLevel | undefined => {
  // Return the given level, once up to date for the points that we have taken into account (see Note #5 above), unless
  // we don't have it (e.g., if it got dropped, see Note #7 above).

  const level = lod.levels[levelNumber];

  if (!level) {
    return undefined;
  }

  if (level.processedCount < lod.count) {
    processLevel(lod, level, xValues, yValues);

    // Drop our level, and our finer levels, if it hardly reduces the number of points of our trace (see Note #7 above).

    if (lod.count >= MIN_NB_OF_POINTS_TO_DROP_LEVELS && level.count > MAX_LEVEL_RATIO * lod.count) {
      lod.levels.length = levelNumber;

      return undefined;
    }
  }

  return level;
};

const isSegmentEnd = (state: PathLevelState, dx: number, dy: number, squaredDistance: number): boolean => {
  // Return whether the point at the given position (relative to our anchor, in tolerances) can be the end of our
  // segment (see Note #2 above).

  if (squaredDistance <= 1) {
    // Our point is within our tolerance of our anchor, so it can only be the end of our segment if our previous points
    // are within our tolerance of our anchor too.

    return state.maxSquaredDistance === 0;
  }

  return (
    squaredDistance >= state.maxSquaredDistance &&
    (state.fullCone || (state.rightX * dy - state.rightY * dx >= 0 && dx * state.leftY - dy * state.leftX >= 0))
  );
};

const extendSegment = (state: PathLevelState, index: number, dx: number, dy: number, squaredDistance: number): void => {
  // Make the point at the given position (relative to our anchor, in tolerances) the end of our segment, and narrow
  // our cone so that it keeps our point within our tolerance of our segment (see Note #3 above).

  state.last = index;

  if (squaredDistance <= 1) {
    return;
  }

  state.maxSquaredDistance = squaredDistance;

  // The boundaries of the directions that keep our point within our tolerance, i.e. the direction of our point rotated
  // by -asin(1 / distance) and asin(1 / distance), which we don't normalise since we only use them in cross products
  // (i.e. to know which side of a direction another direction is on), hence they are distance^2 times longer than
  // their direction, i.e. (dx * cos + dy * sin, dy * cos - dx * sin) * distance^2 for our right boundary, with
  // cos = sqrt(distance^2 - 1) / distance and sin = 1 / distance.

  const scaledCos = Math.sqrt(squaredDistance - 1);
  const rightX = dx * scaledCos + dy;
  const rightY = dy * scaledCos - dx;
  const leftX = dx * scaledCos - dy;
  const leftY = dy * scaledCos + dx;

  if (state.fullCone) {
    state.fullCone = false;
    state.rightX = rightX;
    state.rightY = rightY;
    state.leftX = leftX;
    state.leftY = leftY;

    return;
  }

  // Our cone is the intersection of our previous cone and of those directions, i.e. the most counterclockwise of their
  // right boundaries and the most clockwise of their left boundaries (since both of them contain the direction of our
  // point and are less than half a turn wide).

  if (state.rightX * rightY - state.rightY * rightX > 0) {
    state.rightX = rightX;
    state.rightY = rightY;
  }

  if (leftX * state.leftY - leftY * state.leftX > 0) {
    state.leftX = leftX;
    state.leftY = leftY;
  }
};

export const selectLevel = (
  lod: PathLevelOfDetail,
  xValues: Float64Array,
  yValues: Float64Array,
  maxXTolerance: number,
  maxYTolerance: number
): PathLevel | undefined => {
  // Return our coarsest level which tolerances are no bigger than the given ones, once up to date (see updatedLevel()),
  // if any (otherwise, all of the points of our trace should be used).
  // Note: our level of detail must have taken all of the points of our trace into account (see update()).

  if (lod.xSize === 0 || !(maxXTolerance > 0) || !(maxYTolerance > 0)) {
    return undefined;
  }

  const level = Math.max(
    0,
    Math.ceil(0.5 * Math.log2(lod.xSize / maxXTolerance)),
    Math.ceil(0.5 * Math.log2(lod.ySize / maxYTolerance))
  );

  return updatedLevel(lod, xValues, yValues, level);
};
