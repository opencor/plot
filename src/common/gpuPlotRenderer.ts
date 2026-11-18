import * as levelOfDetailUtils from './levelOfDetailUtils';
import { isContinuationOf } from './traceValues';

// A GPU-based renderer for the traces (and their markers) of our plots (see PlotWidget.vue).
// Note #1: we use WebGL 2 and a single WebGL context, which is shared by all our plots. Indeed, browsers only
//          allow a limited number of WebGL contexts at any given time (e.g., 16 in Chromium), so we cannot have one per
//          plot. So, our WebGL context renders to a canvas that is not part of our document, and what gets rendered for
//          a plot is then copied to its own (2D) canvas (see render()).
// Note #2: WebGPU is the future, but we use WebGL 2 since not all browsers are optimised for WebGPU yet. Indeed, like
//          what gets rendered using WebGL (see Note #1), what gets rendered using WebGPU would need to be copied to the
//          (2D) canvas of a plot. Chrome does this fast, but Safari is somewhat slow and Firefox is even slower.
// Note #3: the data of a trace is kept on the GPU, as 32-bit floats relative to an origin (i.e. its first finite
//          point), so that we keep as much precision as possible, and it only gets uploaded (again) when it changes.
//          Also, if the data of a trace is a view of the same buffer as before and is at least as long as before, then
//          we assume that only its last value onwards may have changed (e.g., while a simulation is running, its live
//          data gets appended to, with its last value retrieved again), so only that part gets uploaded (see
//          IGpuPlotTrace.update() and traceValues.isContinuationOf()). This means that updating a trace with N new
//          points costs O(N) rather than O(size of the trace).
// Note #4: a trace is drawn as a series of segments, each of which is a quad, with round caps (and therefore round
//          joins) and antialiasing being done in our fragment shader using the distance to the segment, while a marker
//          is drawn as a segment of zero length (i.e. a disc). The segments and markers of a trace are first rendered
//          to a coverage texture using a MAX blend, which then gets composited using the colour and opacity of the
//          trace. This means that a trace is drawn as a single shape (like a stroked path on a 2D canvas), i.e. its
//          overlapping segments don't make it darker (e.g., when a trace is faded).
// Note #5: we may lose our WebGL context (e.g., if the GPU gets reset), in which case we are not available (so that our
//          plots can fall back to drawing their traces themselves) until our context gets restored, at which point our
//          listeners (i.e. our plots) get notified, so that they can redraw themselves (which will get their data
//          uploaded again).
// Note #6: a non-finite value (i.e. a gap in a trace) is uploaded as GAP_VALUE, and a segment with an end beyond
//          GAP_THRESHOLD is discarded by our vertex shader, so that a gap in the data is drawn as a gap in the trace.
// Note #7: if the X values of a trace are sorted, then we only draw its visible points. Also, if it has many more
//          visible points than there are columns (see below), then we only draw the points that are needed for its line
//          to look the same (see levelOfDetailUtils.ts), which we keep in a separate buffer. This means that drawing
//          the line of a trace costs O(number of columns) rather than O(number of points). Also, if the X range is the
//          same as before (e.g., while a simulation is running), then only the selection of the columns from the first
//          point that may have changed gets updated and uploaded, i.e. drawing a few more points costs O(number of new
//          points). The points of a column are not drawn exactly where they would be, but they are all within that
//          column, so we use LOD_COLUMNS_PER_PIXEL columns per pixel, so that what we draw is within half a pixel of
//          what we would otherwise draw. Indeed, with one column per pixel, near-vertical edges could move by up to a
//          pixel, which is visible with antialiasing (e.g., about 1.5% of the pixels of staircases are noticeably
//          different from drawing all of their points, against about 0.9% with two columns per pixel), while four
//          columns per pixel are hardly more accurate (e.g., about 0.6% for staircases), but twice as costly to select
//          (e.g., while zooming, when our points need to be selected for every frame). Our markers, if any, are never
//          reduced (since they wouldn't look the same otherwise), i.e. all of our visible markers get drawn.

const GAP_VALUE = 3.0e38;
const GAP_THRESHOLD = '1.0e38';
const FLOAT32_EPSILON = 2 ** -24; // Relative precision of a 32-bit float.
const MAX_PRECISION_ERROR = 0.25; // Maximum position error that we accept (in canvas pixels), see isPrecise().
const MIN_CAPACITY = 1024; // Minimum capacity (in points) of the buffer of a trace.
const BYTES_PER_POINT = 8; // Two 32-bit floats per point.
const LOD_COLUMNS_PER_PIXEL = 2; // Number of columns per pixel for our level of detail (see Note #7 above).

const SEGMENT_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 aPoint0;
in vec2 aPoint1;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uViewport;
uniform float uRadius;

out vec2 vLocal;
flat out float vLength;

void main() {
  // Discard our segment if one of its ends is a gap.

  vec2 absPoints = max(abs(aPoint0), abs(aPoint1));

  if (max(absPoints.x, absPoints.y) > ${GAP_THRESHOLD}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(0.0);
    vLength = 0.0;

    return;
  }

  // Determine the position (in pixels) of the ends of our segment, and the quad that covers it (and its round caps,
  // plus a pixel for antialiasing).

  vec2 point0 = aPoint0 * uScale + uOffset;
  vec2 point1 = aPoint1 * uScale + uOffset;
  vec2 delta = point1 - point0;
  float segmentLength = length(delta);
  vec2 direction = segmentLength > 0.0 ? delta / segmentLength : vec2(1.0, 0.0);
  vec2 normal = vec2(-direction.y, direction.x);
  float extent = uRadius + 1.0;
  float along = (gl_VertexID & 1) == 0 ? -extent : segmentLength + extent;
  float across = (gl_VertexID & 2) == 0 ? -extent : extent;

  vLocal = vec2(along, across);
  vLength = segmentLength;

  gl_Position = vec4(2.0 * (point0 + along * direction + across * normal) / uViewport - 1.0, 0.0, 1.0);
}
`;

const SEGMENT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vLocal;
flat in float vLength;

uniform float uRadius;

out vec4 oCoverage;

void main() {
  // Determine our coverage using our distance to our segment.

  float segmentDistance = length(vec2(vLocal.x - clamp(vLocal.x, 0.0, vLength), vLocal.y));
  float coverage = clamp(uRadius + 0.5 - segmentDistance, 0.0, 1.0);

  if (coverage <= 0.0) {
    discard;
  }

  oCoverage = vec4(coverage);
}
`;

const COMPOSITE_VERTEX_SHADER = `#version 300 es
void main() {
  // A triangle that covers our whole viewport.

  gl_Position = vec4((gl_VertexID & 1) == 0 ? -1.0 : 3.0, (gl_VertexID & 2) == 0 ? -1.0 : 3.0, 0.0, 1.0);
}
`;

const COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uCoverage;
uniform vec4 uColor;

out vec4 oColor;

void main() {
  oColor = uColor * texelFetch(uCoverage, ivec2(gl_FragCoord.xy), 0).r;
}
`;

// Our WebGL resources.

interface ISegmentProgram {
  program: WebGLProgram;
  point0: number;
  point1: number;
  scale: WebGLUniformLocation | null;
  offset: WebGLUniformLocation | null;
  viewport: WebGLUniformLocation | null;
  radius: WebGLUniformLocation | null;
}

interface ICompositeProgram {
  program: WebGLProgram;
  coverage: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
}

interface IResources {
  segmentProgram: ISegmentProgram;
  compositeProgram: ICompositeProgram;
  vertexArray: WebGLVertexArrayObject;
  coverageTexture: WebGLTexture;
  coverageFramebuffer: WebGLFramebuffer;
  coverageWidth: number;
  coverageHeight: number;
}

const compileShader = (context: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
  const shader = context.createShader(type);

  if (!shader) {
    throw new Error('Failed to create a WebGL shader.');
  }

  context.shaderSource(shader, source);
  context.compileShader(shader);

  if (!context.getShaderParameter(shader, context.COMPILE_STATUS) && !context.isContextLost()) {
    const log = context.getShaderInfoLog(shader);

    context.deleteShader(shader);

    throw new Error(`Failed to compile a WebGL shader: ${log}`);
  }

  return shader;
};

const linkProgram = (context: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram => {
  const program = context.createProgram();

  if (!program) {
    throw new Error('Failed to create a WebGL program.');
  }

  const vertexShader = compileShader(context, context.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(context, context.FRAGMENT_SHADER, fragmentSource);

  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  context.deleteShader(vertexShader);
  context.deleteShader(fragmentShader);

  if (!context.getProgramParameter(program, context.LINK_STATUS) && !context.isContextLost()) {
    const log = context.getProgramInfoLog(program);

    context.deleteProgram(program);

    throw new Error(`Failed to link a WebGL program: ${log}`);
  }

  return program;
};

const createResources = (context: WebGL2RenderingContext): IResources => {
  const segmentProgram = linkProgram(context, SEGMENT_VERTEX_SHADER, SEGMENT_FRAGMENT_SHADER);
  const compositeProgram = linkProgram(context, COMPOSITE_VERTEX_SHADER, COMPOSITE_FRAGMENT_SHADER);
  const vertexArray = context.createVertexArray();
  const coverageTexture = context.createTexture();
  const coverageFramebuffer = context.createFramebuffer();

  if (!vertexArray || !coverageTexture || !coverageFramebuffer) {
    throw new Error('Failed to create some WebGL resources.');
  }

  return {
    segmentProgram: {
      program: segmentProgram,
      point0: context.getAttribLocation(segmentProgram, 'aPoint0'),
      point1: context.getAttribLocation(segmentProgram, 'aPoint1'),
      scale: context.getUniformLocation(segmentProgram, 'uScale'),
      offset: context.getUniformLocation(segmentProgram, 'uOffset'),
      viewport: context.getUniformLocation(segmentProgram, 'uViewport'),
      radius: context.getUniformLocation(segmentProgram, 'uRadius')
    },
    compositeProgram: {
      program: compositeProgram,
      coverage: context.getUniformLocation(compositeProgram, 'uCoverage'),
      color: context.getUniformLocation(compositeProgram, 'uColor')
    },
    vertexArray,
    coverageTexture,
    coverageFramebuffer,
    coverageWidth: 0,
    coverageHeight: 0
  };
};

// The conversion of the data of a trace to what we upload to the GPU (see Note #3 and Note #6 above).

const pointsOrigin = (
  xValues: Float64Array,
  yValues: Float64Array,
  count: number
): [originX: number, originY: number] => {
  // Return the origin of the given points, i.e. their first finite point, if any.

  for (let i = 0; i < count; ++i) {
    const x = xValues[i] as number;
    const y = yValues[i] as number;

    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  return [0, 0];
};

const convertPoints = (
  xValues: Float64Array,
  yValues: Float64Array,
  start: number,
  end: number,
  originX: number,
  originY: number,
  output: Float32Array,
  maxAbsX: number,
  maxAbsY: number
): [maxAbsX: number, maxAbsY: number] => {
  // Convert the given points, from the given start (included) to the given end (excluded), to interleaved X and Y
  // values relative to the given origin (or GAP_VALUE for a non-finite point), from the beginning of the given output,
  // and return the maximum absolute value of our relative X and Y values, given their previous maximum.
  // Note: this function processes all of the data of a trace when it gets uploaded in full (e.g., when plotting new
  //       data), so it only uses local variables. Indeed, V8 cannot keep the variables of a closure (or of a module) in
  //       registers, so updating them here would make it several times slower.

  let xMaxAbs = maxAbsX;
  let yMaxAbs = maxAbsY;

  for (let i = start, j = 0; i < end; ++i, j += 2) {
    const x = xValues[i] as number;
    const y = yValues[i] as number;

    if (Number.isFinite(x) && Number.isFinite(y)) {
      const relativeX = x - originX;
      const relativeY = y - originY;

      output[j] = relativeX;
      output[j + 1] = relativeY;

      xMaxAbs = Math.max(xMaxAbs, Math.abs(relativeX));
      yMaxAbs = Math.max(yMaxAbs, Math.abs(relativeY));
    } else {
      output[j] = GAP_VALUE;
      output[j + 1] = GAP_VALUE;
    }
  }

  return [xMaxAbs, yMaxAbs];
};

// A trace, i.e. its data on the GPU.

export interface IGpuPlotTrace {
  update: (xValues: Float64Array, yValues: Float64Array) => void;
  dispose: () => void;
}

interface IDrawnPoints {
  start: number; // Index of the first point (included) of which we draw the marker.
  end: number; // Index of the last point (excluded) of which we draw the marker.
  lineBuffer: WebGLBuffer | null; // Buffer that contains the points of which we draw the line.
  lineStart: number; // Index of the first point (included), in our line buffer, of which we draw the line.
  lineEnd: number; // Index of the last point (excluded), in our line buffer, of which we draw the line.
}

interface IGpuPlotTraceInternals extends IGpuPlotTrace {
  buffer: () => WebGLBuffer | null;
  count: () => number;
  originX: () => number;
  originY: () => number;
  maxAbsX: () => number;
  maxAbsY: () => number;
  drawnPoints: (
    context: WebGL2RenderingContext,
    area: IGpuPlotArea,
    lineWidth: number,
    useLevelOfDetail: boolean
  ) => IDrawnPoints;
}

// Rendering.

export interface IGpuPlotArea {
  // Our plotting area (in canvas pixels) and the ranges of our axes.

  left: number;
  top: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface IGpuPlotItem {
  trace: IGpuPlotTrace;
  color: string;
  alpha: number;
  lineWidth: number; // In canvas pixels.
  markerSize: number; // In canvas pixels, with zero meaning no markers.
  levelOfDetail?: boolean; // Whether to only draw the points that are needed (see Note #7 above), true by default.
}

const axisFactors = (area: IGpuPlotArea): [number, number] => {
  return [area.width / (area.xMax - area.xMin), area.height / (area.yMax - area.yMin)];
};

export const isPrecise = (area: IGpuPlotArea, items: IGpuPlotItem[]): boolean => {
  // Return whether our data is precise enough to be rendered with the given ranges, i.e. whether the error on the
  // position of a point due to our use of 32-bit floats would be negligible (which may not be the case if we are zoomed
  // in a lot).

  const [xFactor, yFactor] = axisFactors(area);

  if (!Number.isFinite(xFactor) || !Number.isFinite(yFactor)) {
    return false;
  }

  return items.every((item: IGpuPlotItem) => {
    const trace = item.trace as IGpuPlotTraceInternals;

    return (
      trace.maxAbsX() * FLOAT32_EPSILON * Math.abs(xFactor) <= MAX_PRECISION_ERROR &&
      trace.maxAbsY() * FLOAT32_EPSILON * Math.abs(yFactor) <= MAX_PRECISION_ERROR
    );
  });
};

// Our renderer.
// Note: we only ever need one renderer (see Note #1 above), i.e. gpuPlotRenderer below, but being able to create one
//       means that our tests can each use their own renderer.

export interface IGpuPlotPointCounts {
  // The number of points that got rendered, i.e. the total number of points of our traces and the number of them that
  // actually got drawn (see Note #7 above).

  nbOfPoints: number;
  nbOfDrawnPoints: number;
}

export interface IGpuPlotRenderer {
  isAvailable: () => boolean;
  onRestored: (listener: () => void) => () => void;
  createTrace: () => IGpuPlotTrace;
  render: (
    target: CanvasRenderingContext2D,
    area: IGpuPlotArea,
    items: IGpuPlotItem[],
    pointCounts?: IGpuPlotPointCounts
  ) => boolean;
}

let uploadBuffer = new Float32Array(0);
let selectionUploadBuffer = new Float32Array(0);

export const createGpuPlotRenderer = (): IGpuPlotRenderer => {
  let canvas: HTMLCanvasElement | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let resources: IResources | null = null;
  let initialised = false;
  let contextLost = false;
  let generation = 0;
  const restoredListeners = new Set<() => void>();

  const initialise = (): void => {
    // Initialise ourselves, but only once.
    // Note: this must only be called from our renderer since it uses the DOM.

    if (initialised) {
      return;
    }

    initialised = true;

    try {
      canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;

      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      });

      if (!gl) {
        return;
      }

      const context = gl;

      resources = createResources(context);

      canvas.addEventListener('webglcontextlost', (event: Event) => {
        // Let the browser know that we want our context to be restored.

        event.preventDefault();

        contextLost = true;
        resources = null;
      });

      canvas.addEventListener('webglcontextrestored', () => {
        try {
          resources = createResources(context);
          contextLost = false;

          // Our traces' buffers are gone, so make sure that they get recreated (see IGpuPlotTrace.update()) and let our
          // listeners know that they can redraw themselves.

          ++generation;

          for (const listener of restoredListeners) {
            listener();
          }
        } catch (error: unknown) {
          console.error('@opencor/plot: the GPU plot renderer could not be restored:', error);

          resources = null;
        }
      });
    } catch (error: unknown) {
      console.error('@opencor/plot: the GPU plot renderer could not be initialised:', error);

      gl = null;
      resources = null;
    }
  };

  const isAvailable = (): boolean => {
    // Return whether we can be used.
    // Note: our context may be lost before we get told about it (see initialise()), in which case we are not available
    //       either. Otherwise, a plot that failed to render its traces because of it (see render()) and that redraws
    //       itself straight away would keep trying (and failing) to use us until we get told about it.

    initialise();

    return !!gl && !!resources && !contextLost && !gl.isContextLost();
  };

  const onRestored = (listener: () => void): (() => void) => {
    // Let the given listener know when our WebGL context gets restored, and return a function to stop doing so.

    restoredListeners.add(listener);

    return () => {
      restoredListeners.delete(listener);
    };
  };

  const createTrace = (): IGpuPlotTrace => {
    let buffer: WebGLBuffer | null = null;
    let bufferGeneration = -1;
    let capacity = 0;
    let count = 0;
    let xValues: Float64Array | undefined;
    let yValues: Float64Array | undefined;
    let originX = 0;
    let originY = 0;
    let maxAbsX = 0;
    let maxAbsY = 0;
    let lod = levelOfDetailUtils.create();
    let selectionBuffer: WebGLBuffer | null = null;
    let selectionBufferGeneration = -1;
    let selectionBufferCapacity = 0;

    const update = (newXValues: Float64Array, newYValues: Float64Array): void => {
      if (!isAvailable() || !gl) {
        return;
      }

      const context = gl;

      // Forget about our buffer if it belongs to a lost context.

      if (bufferGeneration !== generation) {
        buffer = null;
        bufferGeneration = generation;
        capacity = 0;
        count = 0;
      }

      // Determine from which point we need to upload our data (see Note #3 above).

      const newCount = Math.min(newXValues.length, newYValues.length);
      const start =
        count > 0 && isContinuationOf(newXValues, xValues) && isContinuationOf(newYValues, yValues)
          ? Math.min(count - 1, newCount)
          : 0;

      xValues = newXValues;
      yValues = newYValues;

      levelOfDetailUtils.invalidate(lod, start);

      // Use the first finite point as our origin, if we are uploading all of our data.

      if (start === 0) {
        [originX, originY] = pointsOrigin(newXValues, newYValues, newCount);
        maxAbsX = 0;
        maxAbsY = 0;
      }

      // Make sure that our buffer is big enough, keeping what we have already uploaded and still need.

      if (newCount > capacity || !buffer) {
        const newCapacity = Math.max(newCount, 2 * capacity, MIN_CAPACITY);
        const newBuffer = context.createBuffer();

        context.bindBuffer(context.ARRAY_BUFFER, newBuffer);
        context.bufferData(context.ARRAY_BUFFER, newCapacity * BYTES_PER_POINT, context.DYNAMIC_DRAW);

        if (buffer && start > 0) {
          context.bindBuffer(context.COPY_READ_BUFFER, buffer);
          context.copyBufferSubData(context.COPY_READ_BUFFER, context.ARRAY_BUFFER, 0, 0, start * BYTES_PER_POINT);
          context.bindBuffer(context.COPY_READ_BUFFER, null);
        }

        if (buffer) {
          context.deleteBuffer(buffer);
        }

        buffer = newBuffer;
        capacity = newCapacity;
      }

      // Upload our (new) data.

      const nbOfValues = 2 * (newCount - start);

      if (nbOfValues > 0) {
        if (uploadBuffer.length < nbOfValues) {
          uploadBuffer = new Float32Array(Math.max(nbOfValues, 2 * uploadBuffer.length));
        }

        [maxAbsX, maxAbsY] = convertPoints(
          newXValues,
          newYValues,
          start,
          newCount,
          originX,
          originY,
          uploadBuffer,
          maxAbsX,
          maxAbsY
        );

        context.bindBuffer(context.ARRAY_BUFFER, buffer);
        context.bufferSubData(context.ARRAY_BUFFER, start * BYTES_PER_POINT, uploadBuffer, 0, nbOfValues);
      }

      context.bindBuffer(context.ARRAY_BUFFER, null);

      count = newCount;
    };

    const dispose = (): void => {
      if (buffer && gl && bufferGeneration === generation) {
        gl.deleteBuffer(buffer);
      }

      if (selectionBuffer && gl && selectionBufferGeneration === generation) {
        gl.deleteBuffer(selectionBuffer);
      }

      buffer = null;
      capacity = 0;
      count = 0;
      xValues = undefined;
      yValues = undefined;
      lod = levelOfDetailUtils.create();
      selectionBuffer = null;
      selectionBufferCapacity = 0;
    };

    const uploadSelection = (
      context: WebGL2RenderingContext,
      selection: levelOfDetailUtils.ISelection,
      xs: Float64Array,
      ys: Float64Array
    ): WebGLBuffer | null => {
      // Upload the given selection of our points (see Note #7 above), or rather the part of it that changed since we
      // last uploaded it, and return the buffer that contains it.
      // Note: we upload every selection that we make (see drawnPoints()), so the part of our selection that changed
      //       since we last uploaded it is the part that changed since our previous selection.

      let from = selection.firstChanged;

      // Upload our selection in full if our buffer belongs to a lost context or if it is not big enough.

      if (selectionBufferGeneration !== generation) {
        selectionBuffer = null;
        selectionBufferGeneration = generation;
        selectionBufferCapacity = 0;
      }

      if (!selectionBuffer || selectionBufferCapacity < selection.indices.length) {
        if (selectionBuffer) {
          context.deleteBuffer(selectionBuffer);
        }

        selectionBuffer = context.createBuffer();
        selectionBufferCapacity = selection.indices.length;

        context.bindBuffer(context.ARRAY_BUFFER, selectionBuffer);
        context.bufferData(context.ARRAY_BUFFER, selectionBufferCapacity * BYTES_PER_POINT, context.DYNAMIC_DRAW);

        from = 0;
      }

      // Convert and upload our (changed) selected points, which are all finite (since our X values are sorted and
      // there is no gap).

      const nbOfValues = 2 * (selection.nbOfPoints - from);

      if (nbOfValues > 0) {
        if (selectionUploadBuffer.length < nbOfValues) {
          selectionUploadBuffer = new Float32Array(Math.max(nbOfValues, 2 * selectionUploadBuffer.length));
        }

        const values = selectionUploadBuffer;
        const indices = selection.indices;
        const xOrigin = originX;
        const yOrigin = originY;

        for (let i = from, j = 0; i < selection.nbOfPoints; ++i, j += 2) {
          const index = indices[i] as number;

          values[j] = (xs[index] as number) - xOrigin;
          values[j + 1] = (ys[index] as number) - yOrigin;
        }

        context.bindBuffer(context.ARRAY_BUFFER, selectionBuffer);
        context.bufferSubData(context.ARRAY_BUFFER, from * BYTES_PER_POINT, values, 0, nbOfValues);
        context.bindBuffer(context.ARRAY_BUFFER, null);
      }

      return selectionBuffer;
    };

    const drawnPoints = (
      context: WebGL2RenderingContext,
      area: IGpuPlotArea,
      lineWidth: number,
      useLevelOfDetail: boolean
    ): IDrawnPoints => {
      // Return the points that we need to draw for the given plotting area (see Note #7 above), i.e. all of our points
      // (always if we are not to use our level of detail), or only our visible points if our X values are sorted and,
      // for our line, possibly only some of them.

      const res: IDrawnPoints = { start: 0, end: count, lineBuffer: buffer, lineStart: 0, lineEnd: count };
      const nbOfColumns = Math.max(1, Math.ceil(LOD_COLUMNS_PER_PIXEL * area.width));
      const minNbOfPoints = levelOfDetailUtils.MIN_POINTS_PER_COLUMN * nbOfColumns;

      if (!useLevelOfDetail || !xValues || !yValues || count <= minNbOfPoints) {
        return res;
      }

      // Only draw our visible points, if our X values are sorted.
      // Note: we update our level of detail lazily since it is only needed for traces with many points.

      levelOfDetailUtils.update(lod, xValues, yValues, count);

      if (lod.sortedLength < count) {
        return res;
      }

      [res.start, res.end] = levelOfDetailUtils.visibleRange(xValues, count, area.xMin, area.xMax);

      res.lineStart = res.start;
      res.lineEnd = res.end;

      // Only draw the points that are needed for our line to look the same, if we have many visible points (and no gap
      // among them).

      if (lineWidth <= 0 || res.end - res.start <= minNbOfPoints) {
        return res;
      }

      const selection = levelOfDetailUtils.selectPoints(
        lod,
        xValues,
        yValues,
        res.start,
        res.end,
        area.xMin,
        area.xMax,
        nbOfColumns
      );

      if (!selection) {
        return res;
      }

      res.lineBuffer = uploadSelection(context, selection, xValues, yValues);
      res.lineStart = 0;
      res.lineEnd = selection.nbOfPoints;

      return res;
    };

    const res: IGpuPlotTraceInternals = {
      update,
      dispose,
      buffer: () => (bufferGeneration === generation ? buffer : null),
      count: () => count,
      originX: () => originX,
      originY: () => originY,
      maxAbsX: () => maxAbsX,
      maxAbsY: () => maxAbsY,
      drawnPoints
    };

    return res;
  };

  const colorComponents = new Map<string, [number, number, number, number]>();
  let colorContext: CanvasRenderingContext2D | null | undefined;

  const rgba = (color: string): [number, number, number, number] => {
    // Return the (non-premultiplied) RGBA components of the given CSS colour, in the [0, 1] range, by letting a canvas
    // parse and draw it (so that any CSS colour is supported).

    const cachedComponents = colorComponents.get(color);

    if (cachedComponents) {
      return cachedComponents;
    }

    if (colorContext === undefined) {
      const colorCanvas = document.createElement('canvas');

      colorCanvas.width = 1;
      colorCanvas.height = 1;

      colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
    }

    let res: [number, number, number, number] = [0, 0, 0, 1];

    if (colorContext) {
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = '#000';
      colorContext.fillStyle = color;
      colorContext.fillRect(0, 0, 1, 1);

      const [r = 0, g = 0, b = 0, a = 0] = colorContext.getImageData(0, 0, 1, 1).data;

      res = [r / 255, g / 255, b / 255, a / 255];
    }

    colorComponents.set(color, res);

    return res;
  };

  const render = (
    target: CanvasRenderingContext2D,
    area: IGpuPlotArea,
    items: IGpuPlotItem[],
    pointCounts?: IGpuPlotPointCounts
  ): boolean => {
    // Render the given items on the given canvas, within the given plotting area, and return whether we could. If
    // requested, also return the number of points that we rendered and drew.
    // Note #1: like uPlot (and our SVG export, see svgDocument() in PlotWidget.vue), our traces are clipped to our
    //          plotting area extended by half their line width, while our markers are clipped to our plotting area.
    // Note #2: the number of points that we drew for a trace is the number of points of its line or of its markers,
    //          whichever is bigger.

    if (pointCounts) {
      pointCounts.nbOfPoints = 0;
      pointCounts.nbOfDrawnPoints = 0;
    }

    if (!isAvailable() || !gl || !canvas || !resources) {
      return false;
    }

    // Determine the region (in canvas pixels) that we need to render, i.e. our plotting area extended by half the width
    // of our widest line.

    const margin = Math.max(0, ...items.map((item: IGpuPlotItem) => 0.5 * item.lineWidth));
    const regionLeft = Math.floor(area.left - margin);
    const regionTop = Math.floor(area.top - margin);
    const regionWidth = Math.ceil(area.left + area.width + margin) - regionLeft;
    const regionHeight = Math.ceil(area.top + area.height + margin) - regionTop;

    if (regionWidth <= 0 || regionHeight <= 0) {
      return true;
    }

    // Make sure that our canvas and coverage texture are big enough.
    // Note: we only ever grow them, so that we don't keep reallocating them when rendering plots of different sizes.

    const sharedCanvas = canvas;

    if (sharedCanvas.width < regionWidth || sharedCanvas.height < regionHeight) {
      sharedCanvas.width = Math.max(sharedCanvas.width, regionWidth);
      sharedCanvas.height = Math.max(sharedCanvas.height, regionHeight);
    }

    const context = gl;

    if (resources.coverageWidth < sharedCanvas.width || resources.coverageHeight < sharedCanvas.height) {
      resources.coverageWidth = sharedCanvas.width;
      resources.coverageHeight = sharedCanvas.height;

      context.bindTexture(context.TEXTURE_2D, resources.coverageTexture);
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.R8,
        resources.coverageWidth,
        resources.coverageHeight,
        0,
        context.RED,
        context.UNSIGNED_BYTE,
        null
      );
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
      context.bindTexture(context.TEXTURE_2D, null);

      context.bindFramebuffer(context.FRAMEBUFFER, resources.coverageFramebuffer);
      context.framebufferTexture2D(
        context.FRAMEBUFFER,
        context.COLOR_ATTACHMENT0,
        context.TEXTURE_2D,
        resources.coverageTexture,
        0
      );
    }

    // Our scissor rectangles (in WebGL coordinates, i.e. with the origin at the bottom left of our region), i.e. for
    // our traces (see above) and for our markers (i.e. our plotting area).

    const scissor = (left: number, top: number, right: number, bottom: number): [number, number, number, number] => {
      const scissorLeft = Math.max(0, Math.round(left - regionLeft));
      const scissorTop = Math.max(0, Math.round(top - regionTop));
      const scissorRight = Math.min(regionWidth, Math.round(right - regionLeft));
      const scissorBottom = Math.min(regionHeight, Math.round(bottom - regionTop));

      return [
        scissorLeft,
        regionHeight - scissorBottom,
        Math.max(0, scissorRight - scissorLeft),
        Math.max(0, scissorBottom - scissorTop)
      ];
    };

    const areaRight = area.left + area.width;
    const areaBottom = area.top + area.height;
    const markersScissor = scissor(area.left, area.top, areaRight, areaBottom);

    // Clear our region.

    const { segmentProgram, compositeProgram, vertexArray } = resources;

    context.viewport(0, 0, regionWidth, regionHeight);
    context.enable(context.SCISSOR_TEST);
    context.scissor(0, 0, regionWidth, regionHeight);
    context.bindFramebuffer(context.FRAMEBUFFER, null);
    context.clearColor(0, 0, 0, 0);
    context.clear(context.COLOR_BUFFER_BIT);
    context.enable(context.BLEND);
    context.bindVertexArray(vertexArray);

    // Render our items, one by one.

    const [xFactor, yFactor] = axisFactors(area);

    for (const item of items) {
      const trace = item.trace as IGpuPlotTraceInternals;
      const buffer = trace.buffer();
      const count = trace.count();
      const [r, g, b, a] = rgba(item.color);
      const alpha = a * item.alpha;

      if (!buffer || count === 0 || alpha <= 0) {
        continue;
      }

      // Render the coverage of our trace and of its markers, if any.

      context.bindFramebuffer(context.FRAMEBUFFER, resources.coverageFramebuffer);
      context.scissor(0, 0, regionWidth, regionHeight);
      context.clear(context.COLOR_BUFFER_BIT);
      context.blendEquation(context.MAX);
      context.blendFunc(context.ONE, context.ONE);

      context.useProgram(segmentProgram.program);
      context.uniform2f(segmentProgram.viewport, regionWidth, regionHeight);
      context.uniform2f(segmentProgram.scale, xFactor, yFactor);
      context.uniform2f(
        segmentProgram.offset,
        area.left - regionLeft + (trace.originX() - area.xMin) * xFactor,
        regionHeight - (areaBottom - regionTop) + (trace.originY() - area.yMin) * yFactor
      );

      context.enableVertexAttribArray(segmentProgram.point0);
      context.enableVertexAttribArray(segmentProgram.point1);
      context.vertexAttribDivisor(segmentProgram.point0, 1);
      context.vertexAttribDivisor(segmentProgram.point1, 1);

      const traceScissor = scissor(
        area.left - 0.5 * item.lineWidth,
        area.top - 0.5 * item.lineWidth,
        areaRight + 0.5 * item.lineWidth,
        areaBottom + 0.5 * item.lineWidth
      );

      const { start, end, lineBuffer, lineStart, lineEnd } = trace.drawnPoints(
        context,
        area,
        item.lineWidth,
        item.levelOfDetail ?? true
      );
      let nbOfDrawnPoints = 0;

      if (lineBuffer && lineEnd - lineStart > 1 && item.lineWidth > 0) {
        nbOfDrawnPoints = lineEnd - lineStart;

        const offset = lineStart * BYTES_PER_POINT;

        context.bindBuffer(context.ARRAY_BUFFER, lineBuffer);
        context.scissor(...traceScissor);
        context.vertexAttribPointer(segmentProgram.point0, 2, context.FLOAT, false, BYTES_PER_POINT, offset);
        context.vertexAttribPointer(
          segmentProgram.point1,
          2,
          context.FLOAT,
          false,
          BYTES_PER_POINT,
          offset + BYTES_PER_POINT
        );
        context.uniform1f(segmentProgram.radius, 0.5 * item.lineWidth);
        context.drawArraysInstanced(context.TRIANGLE_STRIP, 0, 4, lineEnd - lineStart - 1);
      }

      if (item.markerSize > 0 && end > start) {
        nbOfDrawnPoints = Math.max(nbOfDrawnPoints, end - start);

        const offset = start * BYTES_PER_POINT;

        context.bindBuffer(context.ARRAY_BUFFER, buffer);
        context.scissor(...markersScissor);
        context.vertexAttribPointer(segmentProgram.point0, 2, context.FLOAT, false, BYTES_PER_POINT, offset);
        context.vertexAttribPointer(segmentProgram.point1, 2, context.FLOAT, false, BYTES_PER_POINT, offset);
        context.uniform1f(segmentProgram.radius, 0.5 * item.markerSize);
        context.drawArraysInstanced(context.TRIANGLE_STRIP, 0, 4, end - start);
      }

      context.disableVertexAttribArray(segmentProgram.point0);
      context.disableVertexAttribArray(segmentProgram.point1);
      context.bindBuffer(context.ARRAY_BUFFER, null);

      if (pointCounts) {
        pointCounts.nbOfPoints += count;
        pointCounts.nbOfDrawnPoints += nbOfDrawnPoints;
      }

      // Composite our trace using its colour and opacity.

      context.bindFramebuffer(context.FRAMEBUFFER, null);
      context.scissor(0, 0, regionWidth, regionHeight);
      context.blendEquation(context.FUNC_ADD);
      context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);

      context.useProgram(compositeProgram.program);
      context.activeTexture(context.TEXTURE0);
      context.bindTexture(context.TEXTURE_2D, resources.coverageTexture);
      context.uniform1i(compositeProgram.coverage, 0);
      context.uniform4f(compositeProgram.color, r * alpha, g * alpha, b * alpha, alpha);
      context.drawArrays(context.TRIANGLES, 0, 3);
      context.bindTexture(context.TEXTURE_2D, null);
    }

    context.bindVertexArray(null);
    context.disable(context.BLEND);
    context.disable(context.SCISSOR_TEST);

    // Copy our region to the given canvas.
    // Note: we do this straight away, i.e. before our drawing buffer gets cleared (since we don't preserve it).

    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
    target.drawImage(
      sharedCanvas,
      0,
      sharedCanvas.height - regionHeight,
      regionWidth,
      regionHeight,
      regionLeft,
      regionTop,
      regionWidth,
      regionHeight
    );
    target.restore();

    return !context.isContextLost();
  };

  return { isAvailable, onRestored, createTrace, render };
};

export const gpuPlotRenderer = createGpuPlotRenderer();
