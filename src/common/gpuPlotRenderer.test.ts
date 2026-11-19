import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  createGpuPlotRenderer,
  type IGpuPlotArea,
  type IGpuPlotPointCounts,
  type IGpuPlotRenderer,
  type IGpuPlotTrace,
  isPrecise
} from './gpuPlotRenderer';
import * as levelOfDetailUtils from './levelOfDetailUtils';
import * as pathLevelOfDetailUtils from './pathLevelOfDetailUtils';

// A fake WebGL 2 context, since there is no WebGL in our test environment.
// Note #1: our fake context records the calls that are made to it, and keeps track of the contents of its buffers, so
//          that we can check what gets uploaded and drawn. It cannot, however, check what our shaders draw.
// Note #2: the constants of our fake context are their own name (e.g., context.ARRAY_BUFFER is 'ARRAY_BUFFER'), so that
//          our recorded calls are easy to read.
// Note #3: some of the calls made to our fake context can be made to fail (e.g., to compile a shader), using their
//          name.

interface IFakeObject {
  kind: string;
}

interface IFakeContext {
  context: WebGL2RenderingContext;
  canvas: HTMLCanvasElement | undefined;
  calls: [name: string, args: unknown[]][];
  buffers: IFakeObject[];
  data: Map<IFakeObject, Float32Array>;
  lost: boolean;
  failures: Set<string>;
}

const createFakeContext = (failures: string[]): IFakeContext => {
  const res: IFakeContext = {
    context: undefined as unknown as WebGL2RenderingContext,
    canvas: undefined,
    calls: [],
    buffers: [],
    data: new Map(),
    lost: false,
    failures: new Set(failures)
  };
  const boundBuffers = new Map<string, IFakeObject | null>();
  const fakeObject = (kind: string): IFakeObject | null => {
    return res.failures.has(`create${kind}`) ? null : { kind };
  };
  const boundData = (target: string): Float32Array => {
    return res.data.get(boundBuffers.get(target) as IFakeObject) as Float32Array;
  };
  const implementations: Record<string, (...args: never[]) => unknown> = {
    createShader: () => fakeObject('Shader'),
    createProgram: () => fakeObject('Program'),
    createVertexArray: () => fakeObject('VertexArray'),
    createTexture: () => fakeObject('Texture'),
    createFramebuffer: () => fakeObject('Framebuffer'),
    createBuffer: () => {
      const buffer = fakeObject('Buffer') as IFakeObject;

      res.buffers.push(buffer);

      return buffer;
    },
    getShaderParameter: () => !res.failures.has('compileShader'),
    getShaderInfoLog: () => 'Some shader log.',
    getProgramParameter: () => !res.failures.has('linkProgram'),
    getProgramInfoLog: () => 'Some program log.',
    getAttribLocation: (_program: never, name: string) => (name === 'aPoint0' ? 0 : 1),
    getUniformLocation: (_program: never, name: string) => name,
    isContextLost: () => res.lost,
    bindBuffer: (target: string, buffer: IFakeObject | null) => {
      boundBuffers.set(target, buffer);
    },
    bufferData: (target: string, size: number) => {
      res.data.set(boundBuffers.get(target) as IFakeObject, new Float32Array(size / 4));
    },
    bufferSubData: (target: string, offset: number, source: Float32Array, sourceOffset: number, length: number) => {
      boundData(target).set(source.subarray(sourceOffset, sourceOffset + length), offset / 4);
    },
    copyBufferSubData: (
      readTarget: string,
      writeTarget: string,
      readOffset: number,
      writeOffset: number,
      size: number
    ) => {
      boundData(writeTarget).set(
        boundData(readTarget).subarray(readOffset / 4, (readOffset + size) / 4),
        writeOffset / 4
      );
    }
  };

  res.context = new Proxy(
    {},
    {
      get: (_target: object, name: string) => {
        if (/^[A-Z0-9_]+$/.test(name)) {
          return name;
        }

        return (...args: never[]) => {
          res.calls.push([name, args]);

          return implementations[name]?.(...args);
        };
      }
    }
  ) as WebGL2RenderingContext;

  return res;
};

// A fake 2D context, which we use to parse a few colours (see rgba() in gpuPlotRenderer.ts).

const COLORS: Record<string, number[]> = {
  '#f00': [255, 0, 0, 255],
  'rgb(0 0 255 / 50%)': [0, 0, 255, 128]
};

type IFake2dContext = CanvasRenderingContext2D & { nbOfParsedColors: number; drawImageCalls: unknown[][] };

const createFake2dContext = (): IFake2dContext => {
  // Note: this is also the 2D context of the snapshot of our renderer (see Note #8 of gpuPlotRenderer.ts), hence we
  //       keep track of what gets drawn on it.

  const res = {
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    nbOfParsedColors: 0,
    drawImageCalls: [] as unknown[][],
    clearRect: () => {},
    fillRect: () => {},
    drawImage: (...args: unknown[]) => {
      res.drawImageCalls.push(args);
    },
    getImageData: () => {
      ++res.nbOfParsedColors;

      return { data: COLORS[res.fillStyle] ?? [0, 0, 0, 0] };
    }
  };

  return res as unknown as IFake2dContext;
};

// A fake 2D context to render to.

interface IFakeTarget {
  context: CanvasRenderingContext2D;
  drawImageCalls: unknown[][];
}

const createFakeTarget = (): IFakeTarget => {
  const drawImageCalls: unknown[][] = [];

  return {
    context: {
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      drawImage: (...args: unknown[]) => {
        drawImageCalls.push(args);
      }
    } as unknown as CanvasRenderingContext2D,
    drawImageCalls
  };
};

// Some helpers.

const createRenderer = (
  failures: string[] = []
): { renderer: IGpuPlotRenderer; fake: IFakeContext; fake2d: ReturnType<typeof createFake2dContext> } => {
  // Create a renderer that uses a fake WebGL 2 context (and a fake 2D context to parse colours).

  const fake = createFakeContext(failures);
  const fake2d = createFake2dContext();

  spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string
  ) {
    if (contextId === 'webgl2') {
      fake.canvas = this;

      return fake.failures.has('webgl2') ? null : fake.context;
    }

    return fake2d;
  } as typeof HTMLCanvasElement.prototype.getContext);

  return { renderer: createGpuPlotRenderer(), fake, fake2d };
};

const calls = (fake: IFakeContext, name: string): unknown[][] => {
  return fake.calls.filter(([callName]) => callName === name).map(([, args]) => args);
};

const GAP = Math.fround(3.0e38);

const uploadedPoints = (fake: IFakeContext, nbOfPoints: number): number[] => {
  // Return the given number of points that were uploaded to our last buffer.

  return Array.from((fake.data.get(fake.buffers.at(-1) as IFakeObject) as Float32Array).subarray(0, 2 * nbOfPoints));
};

const AREA: IGpuPlotArea = {
  left: 10,
  top: 20,
  width: 100,
  height: 50,
  xMin: 0,
  xMax: 10,
  yMin: -1,
  yMax: 1
};

afterEach(() => {
  mock.restore();
});

// Initialisation.

describe('initialisation', () => {
  it('is not available without WebGL 2', () => {
    const { renderer, fake } = createRenderer(['webgl2']);
    const trace = renderer.createTrace();

    expect(renderer.isAvailable()).toBe(false);

    trace.update(Float64Array.from([1, 2]), Float64Array.from([3, 4]));

    expect(fake.buffers.length).toBe(0);
    expect(
      renderer.render(createFakeTarget().context, AREA, [
        { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }
      ])
    ).toBe(false);
  });

  it('initialises itself only once', () => {
    const { renderer } = createRenderer();

    expect(renderer.isAvailable()).toBe(true);
    expect(renderer.isAvailable()).toBe(true);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(1);
  });

  it('is not available if its WebGL resources cannot be created', () => {
    for (const [failure, message] of [
      ['createShader', 'Failed to create a WebGL shader.'],
      ['compileShader', 'Failed to compile a WebGL shader: Some shader log.'],
      ['createProgram', 'Failed to create a WebGL program.'],
      ['linkProgram', 'Failed to link a WebGL program: Some program log.'],
      ['createVertexArray', 'Failed to create some WebGL resources.']
    ] as const) {
      const consoleError = spyOn(console, 'error').mockImplementation(() => {});
      const { renderer } = createRenderer([failure]);

      expect(renderer.isAvailable()).toBe(false);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        '@opencor/plot: the GPU plot renderer could not be initialised:',
        expect.objectContaining({ message })
      );

      mock.restore();
    }
  });

  it('ignores shader and program errors if its context is lost', () => {
    // Note: the status of a shader or program is meaningless if our context is lost, in which case we will be able to
    //       recreate our resources once our context gets restored.

    const { renderer, fake } = createRenderer(['compileShader', 'linkProgram']);
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});

    fake.lost = true;

    expect(renderer.isAvailable()).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();

    fake.lost = false;

    expect(renderer.isAvailable()).toBe(true);
  });
});

// Traces.

describe('createTrace()', () => {
  it('uploads the data of a trace relative to its first finite point, with a gap for a non-finite point', () => {
    const { renderer, fake } = createRenderer();

    renderer
      .createTrace()
      .update(Float64Array.from([Number.NaN, 1, 2, 3]), Float64Array.from([5, 10, Number.POSITIVE_INFINITY, 30]));

    expect(calls(fake, 'bufferData')).toEqual([['ARRAY_BUFFER', 1024 * 8, 'DYNAMIC_DRAW']]);
    expect(uploadedPoints(fake, 4)).toEqual([GAP, GAP, 0, 0, GAP, GAP, 2, 20]);
  });

  it('uses the origin as the origin of a trace without any finite point', () => {
    const { renderer, fake } = createRenderer();

    renderer.createTrace().update(Float64Array.from([Number.NaN, 1]), Float64Array.from([2, Number.NaN]));

    expect(uploadedPoints(fake, 2)).toEqual([GAP, GAP, GAP, GAP]);
  });

  it('only uploads the new points of a continuation (and its last point again)', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const xValues = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const yValues = Float64Array.from([1, 2, 3, 4, 5, 6]);

    trace.update(xValues.subarray(0, 3), yValues.subarray(0, 3));

    yValues[2] = 9; // Our last point may change.

    trace.update(xValues, yValues);

    expect(calls(fake, 'createBuffer').length).toBe(1);
    expect(calls(fake, 'bufferSubData').map(([, offset, , , length]) => [offset, length])).toEqual([
      [0, 6],
      [2 * 8, 8]
    ]);
    expect(uploadedPoints(fake, 6)).toEqual([0, 0, 1, 1, 2, 8, 3, 3, 4, 4, 5, 5]);
  });

  it('uploads all of its points again if they are not a continuation of the previous ones', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();

    trace.update(Float64Array.from([1, 2, 3]), Float64Array.from([1, 2, 3]));
    trace.update(Float64Array.from([5, 6]), Float64Array.from([7, 8]));

    expect(calls(fake, 'bufferSubData').map(([, offset, , , length]) => [offset, length])).toEqual([
      [0, 6],
      [0, 4]
    ]);
    expect(uploadedPoints(fake, 2)).toEqual([0, 0, 1, 1]);
  });

  it('grows its buffer, keeping the points that it still needs', () => {
    // Note: we start with different numbers of points, so that we keep one or many of them (i.e. all but the last one).

    for (const nbOfPoints of [2, 1000]) {
      const { renderer, fake } = createRenderer();
      const trace = renderer.createTrace();
      const xValues = Float64Array.from({ length: 1500 }, (_value, i) => i);
      const yValues = Float64Array.from({ length: 1500 }, (_value, i) => 2 * i);

      trace.update(xValues.subarray(0, nbOfPoints), yValues.subarray(0, nbOfPoints));
      trace.update(xValues, yValues);

      const [oldBuffer, newBuffer] = fake.buffers;

      expect(calls(fake, 'bufferData').map(([, size]) => size)).toEqual([1024 * 8, 2048 * 8]);
      expect(calls(fake, 'copyBufferSubData')).toEqual([
        ['COPY_READ_BUFFER', 'ARRAY_BUFFER', 0, 0, (nbOfPoints - 1) * 8]
      ]);
      expect(calls(fake, 'deleteBuffer')).toEqual([[oldBuffer]]);
      expect(fake.buffers.at(-1)).toBe(newBuffer as IFakeObject);
      expect(uploadedPoints(fake, 1500)).toEqual(Array.from({ length: 1500 }, (_value, i) => [i, 2 * i]).flat());

      mock.restore();
    }
  });

  it('only uses as many points as there are both X and Y values', () => {
    const { renderer, fake } = createRenderer();

    renderer.createTrace().update(Float64Array.from([1, 2, 3]), Float64Array.from([4, 5]));

    expect(calls(fake, 'bufferSubData').map(([, , , , length]) => length)).toEqual([4]);
  });

  it('deletes its buffer when disposed of', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const xValues = Float64Array.from([1, 2, 3]);

    trace.update(xValues, xValues);
    trace.dispose();

    expect(calls(fake, 'deleteBuffer')).toEqual([[fake.buffers[0]]]);

    // Our points get uploaded in full again, even if they are the same as before.

    trace.update(xValues, xValues);

    expect(fake.buffers.length).toBe(2);
    expect(calls(fake, 'bufferSubData').map(([, offset, , , length]) => [offset, length])).toEqual([
      [0, 6],
      [0, 6]
    ]);

    // Disposing of a trace that has no buffer does nothing.

    const otherTrace = renderer.createTrace();

    otherTrace.dispose();

    expect(calls(fake, 'deleteBuffer').length).toBe(1);
  });
});

// isPrecise().

describe('isPrecise()', () => {
  it('determines whether our 32-bit floats are precise enough for the given ranges', () => {
    const { renderer } = createRenderer();
    const trace = renderer.createTrace();
    const item = { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 };

    trace.update(Float64Array.from([0, 1e5]), Float64Array.from([0, 1]));

    expect(isPrecise(AREA, [item])).toBe(true);
    expect(isPrecise({ ...AREA, xMin: 0, xMax: 1e-3 }, [item])).toBe(false);
    expect(isPrecise({ ...AREA, yMin: 0, yMax: 1e-9 }, [item])).toBe(false);
    expect(isPrecise({ ...AREA, xMin: 1, xMax: 1 }, [item])).toBe(false);
    expect(isPrecise({ ...AREA, yMin: 1, yMax: 1 }, [item])).toBe(false);
  });

  it('determines whether some of our points would be mistaken for gaps', () => {
    // Our X range is huge, so that our 32-bit floats are precise enough, but a point (relative to our origin) that is
    // beyond our gap threshold would be mistaken for a gap by our vertex shader (see Note #6 of gpuPlotRenderer.ts).

    const { renderer } = createRenderer();
    const trace = renderer.createTrace();
    const item = { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 };
    const area = { ...AREA, xMin: 0, xMax: 1e40 };

    trace.update(Float64Array.from([0, 5e37]), Float64Array.from([0, 1]));

    expect(isPrecise(area, [item])).toBe(true);

    trace.update(Float64Array.from([0, 2e38]), Float64Array.from([0, 1]));

    expect(isPrecise(area, [item])).toBe(false);

    trace.update(Float64Array.from([0, 1]), Float64Array.from([0, -2e38]));

    expect(isPrecise({ ...area, yMin: -1e40, yMax: 1e40 }, [item])).toBe(false);
  });
});

// render().

describe('render()', () => {
  const traceWith = (renderer: IGpuPlotRenderer, nbOfPoints: number): IGpuPlotTrace => {
    const res = renderer.createTrace();
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i);

    res.update(xValues, xValues.map(Math.sin));

    return res;
  };

  const compositedColors = (fake: IFakeContext): number[][] => {
    // Return the colours with which our batches of traces were composited.

    return calls(fake, 'uniform4fv').map(([, colors]) => Array.from(colors as Float32Array));
  };

  it('renders the lines and markers of some traces, and copies them to the given canvas', async () => {
    const { renderer, fake } = createRenderer();
    const target = createFakeTarget();
    const items = [
      { trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 4, markerSize: 0 },
      { trace: traceWith(renderer, 7), color: 'rgb(0 0 255 / 50%)', alpha: 0.5, lineWidth: 2, markerSize: 6 }
    ];

    fake.calls.length = 0;

    expect(renderer.render(target.context, AREA, items)).toBe(true);

    // Our region is our plotting area extended by half the width of our widest line, i.e. 2 pixels.

    expect(calls(fake, 'viewport')).toEqual([
      [0, 0, 104, 54],
      [0, 0, 104, 54]
    ]);
    expect(fake.canvas?.width).toBe(104);
    expect(fake.canvas?.height).toBe(54);
    expect(calls(fake, 'texImage2D')).toEqual([['TEXTURE_2D', 0, 'RGBA8', 104, 54, 0, 'RGBA', 'UNSIGNED_BYTE', null]]);

    // Our lines (i.e. one segment less than points) and markers (i.e. one segment of zero length per point), with our
    // lines being clipped to our plotting area extended by half their width, and our markers to our plotting area.

    expect(calls(fake, 'drawArraysInstanced')).toEqual([
      ['TRIANGLE_STRIP', 0, 4, 4],
      ['TRIANGLE_STRIP', 0, 4, 6],
      ['TRIANGLE_STRIP', 0, 4, 7]
    ]);
    expect(calls(fake, 'uniform1f')).toEqual([
      ['uRadius', 2],
      ['uRadius', 1],
      ['uRadius', 3]
    ]);
    expect(calls(fake, 'scissor').filter(([, , width, height]) => width !== 104 || height !== 54)).toEqual([
      [1, 1, 102, 52],
      [2, 2, 100, 50]
    ]);

    // The coverage of each of our traces is rendered to its own channel, and our traces are then composited at once,
    // using their (premultiplied) colour and opacity.

    const alpha = Math.fround((128 / 255) * 0.5);

    expect(calls(fake, 'colorMask')).toEqual([
      [true, true, true, true],
      [true, false, false, false],
      [false, true, false, false],
      [true, true, true, true]
    ]);
    expect(calls(fake, 'drawArrays')).toEqual([['TRIANGLES', 0, 3]]);
    expect(compositedColors(fake)).toEqual([[1, 0, 0, 1, 0, 0, alpha, alpha, 0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(calls(fake, 'uniform2i')).toEqual([['uOrigin', 0, 0]]);

    // The copy of our region to our target, once the current task is done with rendering.

    expect(target.drawImageCalls).toEqual([]);

    await Promise.resolve();

    expect(target.drawImageCalls).toEqual([[fake.canvas, 0, 0, 104, 54, 8, 18, 104, 54]]);
  });

  it('renders its traces in batches of four', () => {
    const { renderer, fake } = createRenderer();
    const items = Array.from({ length: 5 }, () => ({
      trace: traceWith(renderer, 5),
      color: '#f00',
      alpha: 1,
      lineWidth: 1,
      markerSize: 0
    }));

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, AREA, items);

    expect(calls(fake, 'clear').length).toBe(1 + 2);
    expect(calls(fake, 'drawArraysInstanced').length).toBe(5);
    expect(calls(fake, 'drawArrays').length).toBe(2);
    expect(compositedColors(fake)).toEqual([
      [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
      [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    ]);
  });

  it('skips traces that have no points or that are fully transparent', () => {
    const { renderer, fake } = createRenderer();

    renderer.render(createFakeTarget().context, AREA, [
      { trace: renderer.createTrace(), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 1 },
      { trace: traceWith(renderer, 5), color: '#f00', alpha: 0, lineWidth: 1, markerSize: 1 }
    ]);

    expect(calls(fake, 'drawArraysInstanced')).toEqual([]);
    expect(calls(fake, 'drawArrays')).toEqual([]);
  });

  it('only renders the marker of a trace with a single point', () => {
    const { renderer, fake } = createRenderer();

    renderer.render(createFakeTarget().context, AREA, [
      { trace: traceWith(renderer, 1), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 1 }
    ]);

    expect(calls(fake, 'drawArraysInstanced')).toEqual([['TRIANGLE_STRIP', 0, 4, 1]]);
  });

  it('returns the number of points that it rendered and drew', () => {
    const { renderer } = createRenderer();
    const pointCounts: IGpuPlotPointCounts = { nbOfPoints: 123, nbOfDrawnPoints: 45 };
    const items = [
      { trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 },
      { trace: traceWith(renderer, 7), color: '#f00', alpha: 1, lineWidth: 0, markerSize: 1 },
      { trace: traceWith(renderer, 1), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 1 },
      { trace: traceWith(renderer, 11), color: '#f00', alpha: 0, lineWidth: 1, markerSize: 1 }
    ];

    // Our first trace only has a line, our second trace only has markers, our third trace only has a marker (since it
    // has a single point), and our fourth trace is not rendered (since it is fully transparent).

    renderer.render(createFakeTarget().context, AREA, items, pointCounts);

    expect(pointCounts).toEqual({ nbOfPoints: 13, nbOfDrawnPoints: 13 });

    // Our counts are reset every time we render.

    renderer.render(createFakeTarget().context, AREA, [], pointCounts);

    expect(pointCounts).toEqual({ nbOfPoints: 0, nbOfDrawnPoints: 0 });
  });

  it('renders nothing for an empty plotting area', () => {
    const { renderer, fake } = createRenderer();
    const target = createFakeTarget();

    expect(
      renderer.render(target.context, { ...AREA, width: 0 }, [
        { trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 0, markerSize: 0 }
      ])
    ).toBe(true);
    expect(calls(fake, 'clear')).toEqual([]);
    expect(target.drawImageCalls).toEqual([]);
  });

  it('only ever grows its canvas and coverage texture', async () => {
    const { renderer, fake } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 0, markerSize: 0 }];

    renderer.render(createFakeTarget().context, AREA, items);

    await Promise.resolve();

    renderer.render(createFakeTarget().context, { ...AREA, width: 50, height: 100 }, items);

    await Promise.resolve();

    renderer.render(createFakeTarget().context, { ...AREA, width: 20, height: 20 }, items);

    expect(calls(fake, 'texImage2D').map(([, , , width, height]) => [width, height])).toEqual([
      [100, 50],
      [100, 100]
    ]);
    expect([fake.canvas?.width, fake.canvas?.height]).toEqual([100, 100]);
  });

  it('renders the plots of a task to their own region of its canvas, and copies them once the task is done', async () => {
    const { renderer, fake, fake2d } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 0, markerSize: 0 }];
    const target1 = createFakeTarget();
    const target2 = createFakeTarget();
    const area2 = { ...AREA, width: 50, height: 100 };

    // Our canvas is too small for both of our regions to start with, so it gets grown (after copying our first
    // region, since growing our canvas clears it), and our second region gets rendered at the top left of it.

    renderer.render(target1.context, AREA, items);

    expect(target1.drawImageCalls.length).toBe(0);

    renderer.render(target2.context, area2, items);

    expect(target1.drawImageCalls).toEqual([[fake.canvas, 0, 0, 100, 50, 10, 20, 100, 50]]);
    expect([fake.canvas?.width, fake.canvas?.height]).toEqual([150, 100]);

    await Promise.resolve();

    expect(target2.drawImageCalls).toEqual([[fake.canvas, 0, 0, 50, 100, 10, 20, 50, 100]]);

    // Our canvas is now big enough for both of our regions, which get rendered next to each other (i.e. with our first
    // region at the top left of our canvas, which in WebGL coordinates is above our second region), and copied once our
    // task is done, i.e. via our snapshot since we have several regions to copy (see Note #8 of gpuPlotRenderer.ts).

    fake.calls.length = 0;

    renderer.render(target1.context, AREA, items);
    renderer.render(target2.context, area2, items);

    expect(calls(fake, 'uniform2i')).toEqual([
      ['uOrigin', 0, 50],
      ['uOrigin', 100, 0]
    ]);
    expect(target1.drawImageCalls.length).toBe(1);
    expect(target2.drawImageCalls.length).toBe(1);

    await Promise.resolve();

    const snapshot = target1.drawImageCalls.at(-1)?.[0];

    expect(snapshot).toBeInstanceOf(HTMLCanvasElement);
    expect(snapshot).not.toBe(fake.canvas);
    expect(fake2d.drawImageCalls.at(-1)).toEqual([fake.canvas, 0, 0, 150, 100, 0, 0, 150, 100]);
    expect(target1.drawImageCalls.at(-1)).toEqual([snapshot, 0, 0, 100, 50, 10, 20, 100, 50]);
    expect(target2.drawImageCalls.at(-1)).toEqual([snapshot, 100, 0, 50, 100, 10, 20, 50, 100]);
  });

  it('renders a region on a new shelf if it is not wide enough, and copies its regions if it is full', async () => {
    const { renderer } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 0, markerSize: 0 }];
    const target1 = createFakeTarget();
    const target2 = createFakeTarget();
    const target3 = createFakeTarget();
    const area = { ...AREA, width: 3000, height: 1500 };

    // Grow our canvas so that it can hold two of our regions, one above the other.

    renderer.render(target1.context, area, items);
    renderer.render(target2.context, area, items);

    await Promise.resolve();

    // Our second region doesn't fit next to our first region, so it goes on a new shelf, while our third region doesn't
    // fit on a new shelf either, so our first two regions get copied first.

    for (const target of [target1, target2, target3]) {
      target.drawImageCalls.length = 0;
    }

    renderer.render(target1.context, area, items);
    renderer.render(target2.context, area, items);

    expect(target1.drawImageCalls.length).toBe(0);

    renderer.render(target3.context, area, items);

    expect(target1.drawImageCalls.map((call) => call.slice(1, 3))).toEqual([[0, 0]]);
    expect(target2.drawImageCalls.map((call) => call.slice(1, 3))).toEqual([[0, 1500]]);
    expect(target3.drawImageCalls.length).toBe(0);

    await Promise.resolve();

    expect(target3.drawImageCalls.map((call) => call.slice(1, 3))).toEqual([[0, 0]]);
  });

  it('only copies the last region rendered for a canvas, and not one that got cancelled', async () => {
    const { renderer } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 0, markerSize: 0 }];
    const target1 = createFakeTarget();
    const target2 = createFakeTarget();

    // Grow our canvas so that it can hold three of our regions, next to each other.

    for (let i = 0; i < 3; ++i) {
      renderer.render(createFakeTarget().context, AREA, items);
    }

    await Promise.resolve();

    renderer.render(target1.context, AREA, items);
    renderer.render(target1.context, { ...AREA, left: 30 }, items);
    renderer.render(target2.context, AREA, items);
    renderer.cancelRender(target2.context);

    await Promise.resolve();

    expect(target1.drawImageCalls.map((call) => call[5])).toEqual([30]);
    expect(target2.drawImageCalls).toEqual([]);
  });

  it('cancels the pending copy to a canvas even if it renders nothing for it', async () => {
    const { renderer } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 0, markerSize: 0 }];
    const target = createFakeTarget();

    renderer.render(target.context, AREA, items);
    renderer.render(target.context, { ...AREA, width: 0 }, items);

    await Promise.resolve();

    expect(target.drawImageCalls).toEqual([]);
  });

  it('parses a colour only once', () => {
    const { renderer, fake2d } = createRenderer();
    const items = [
      { trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 },
      { trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }
    ];

    renderer.render(createFakeTarget().context, AREA, items);
    renderer.render(createFakeTarget().context, AREA, items);

    expect(fake2d.nbOfParsedColors).toBe(1);
  });

  it('uses black if a colour cannot be parsed', () => {
    const { renderer, fake } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];

    // Make our colour canvas unable to give us a 2D context.

    mock.restore();
    spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    renderer.render(createFakeTarget().context, AREA, items);

    expect(compositedColors(fake)).toEqual([[0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
  });

  it('fails if its context gets lost while rendering', () => {
    const { renderer, fake } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];

    fake.lost = true;

    expect(renderer.render(createFakeTarget().context, AREA, items)).toBe(false);
  });
});

// Level of detail.

describe('level of detail', () => {
  // Our plotting area has 200 columns (i.e. 2 per pixel), so our level of detail gets used for a trace with more than
  // 1,600 (visible) points (see LOD_COLUMNS_PER_PIXEL in gpuPlotRenderer.ts and MIN_POINTS_PER_COLUMN in
  // levelOfDetailUtils.ts).

  const NB_OF_POINTS = 10000;
  const LOD_AREA: IGpuPlotArea = { ...AREA, xMin: 1, xMax: NB_OF_POINTS };

  const values = (nbOfPoints: number, phase: number = 0): [xValues: Float64Array, yValues: Float64Array] => {
    // Return some points with sorted X values (from 1 to the given number of points) and Y values that go up and down,
    // so that our level of detail only selects some of them.
    // Note: our first point is not the origin, so that we can check that our points are uploaded relative to it.

    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i + 1);

    return [xValues, xValues.map((x) => Math.sin(0.37 * x + phase) + 0.001 * x + 5)];
  };

  const selectedPoints = (xValues: Float64Array, yValues: Float64Array, area: IGpuPlotArea): number[] => {
    // Return the points that our level of detail selects for the given values and plotting area, relative to their
    // first point and as 32-bit floats (or as gaps, for points with a non-finite X or Y value), i.e. what our renderer
    // should upload.

    const nbOfPoints = Math.min(xValues.length, yValues.length);
    const lod = levelOfDetailUtils.create();

    levelOfDetailUtils.update(lod, xValues, yValues, nbOfPoints);

    const [start, end] = levelOfDetailUtils.visibleRange(lod, xValues, yValues, nbOfPoints, area.xMin, area.xMax);
    const selection = levelOfDetailUtils.selectPoints(
      lod,
      xValues,
      yValues,
      start,
      end,
      area.xMin,
      area.xMax,
      2 * area.width
    );

    return Array.from(selection.indices.subarray(0, selection.nbOfPoints)).flatMap((index) =>
      Number.isFinite(xValues[index] as number) && Number.isFinite(yValues[index] as number)
        ? [
            Math.fround((xValues[index] as number) - (xValues[0] as number)),
            Math.fround((yValues[index] as number) - (yValues[0] as number))
          ]
        : [Math.fround(3.0e38), Math.fround(3.0e38)]
    );
  };

  const bufferPoints = (fake: IFakeContext, buffer: IFakeObject | undefined, nbOfValues: number): number[] => {
    // Return the given number of values that were uploaded to the given buffer.

    return Array.from((fake.data.get(buffer as IFakeObject) as Float32Array).subarray(0, nbOfValues));
  };

  const lineDraws = (fake: IFakeContext): unknown[][] => {
    // Return the offset (in points) of our line and its number of segments, for each line that was drawn.

    const offsets = calls(fake, 'vertexAttribPointer')
      .filter(([index]) => index === 0)
      .map(([, , , , , offset]) => (offset as number) / 8);

    return calls(fake, 'drawArraysInstanced').map(([, , , nbOfInstances], i) => [offsets[i], nbOfInstances]);
  };

  it('only draws the points that are needed for the line of a trace with many sorted points to look the same', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = values(NB_OF_POINTS);

    trace.update(xValues, yValues);

    fake.calls.length = 0;

    const pointCounts: IGpuPlotPointCounts = { nbOfPoints: 0, nbOfDrawnPoints: 0 };

    renderer.render(
      createFakeTarget().context,
      LOD_AREA,
      [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }],
      pointCounts
    );

    // Our selected points get uploaded to a separate buffer, from which our line gets drawn.

    const expectedPoints = selectedPoints(xValues, yValues, LOD_AREA);
    const nbOfSelectedPoints = expectedPoints.length / 2;

    expect(nbOfSelectedPoints).toBeLessThan(NB_OF_POINTS / 2);
    expect(fake.buffers.length).toBe(2);
    expect(bufferPoints(fake, fake.buffers[1], expectedPoints.length)).toEqual(expectedPoints);
    expect(calls(fake, 'bindBuffer')).toContainEqual(['ARRAY_BUFFER', fake.buffers[1]]);
    expect(lineDraws(fake)).toEqual([[0, nbOfSelectedPoints - 1]]);
    expect(pointCounts).toEqual({ nbOfPoints: NB_OF_POINTS, nbOfDrawnPoints: nbOfSelectedPoints });
  });

  it('only draws the visible points of a trace with many sorted points', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = values(NB_OF_POINTS);

    trace.update(xValues, yValues);

    fake.calls.length = 0;

    // Our visible points are those with an X value from 1,000 to 1,100 (i.e. from index 999 to 1,099), as well as the
    // points just before and after them, i.e. 103 points (and therefore 102 segments), which is too few for our level
    // of detail to be used.

    const pointCounts: IGpuPlotPointCounts = { nbOfPoints: 0, nbOfDrawnPoints: 0 };

    renderer.render(
      createFakeTarget().context,
      { ...LOD_AREA, xMin: 1000, xMax: 1100 },
      [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 2 }],
      pointCounts
    );

    expect(fake.buffers.length).toBe(1);
    expect(lineDraws(fake)).toEqual([
      [998, 102],
      [998, 103]
    ]);
    expect(pointCounts).toEqual({ nbOfPoints: NB_OF_POINTS, nbOfDrawnPoints: 103 });

    // Without a line, our level of detail is not used either, even if all of our points are visible.

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, LOD_AREA, [
      { trace, color: '#f00', alpha: 1, lineWidth: 0, markerSize: 2 }
    ]);

    expect(fake.buffers.length).toBe(1);
    expect(lineDraws(fake)).toEqual([[0, NB_OF_POINTS]]);
  });

  it('draws all the points of a trace with many sorted points if its level of detail is not to be used', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = values(NB_OF_POINTS);

    trace.update(xValues, yValues);

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, { ...LOD_AREA, xMin: 1000, xMax: 1100 }, [
      { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 2, levelOfDetail: false }
    ]);

    expect(fake.buffers.length).toBe(1);
    expect(lineDraws(fake)).toEqual([
      [0, NB_OF_POINTS - 1],
      [0, NB_OF_POINTS]
    ]);
  });

  // Some unsorted points, i.e. a smooth curve (so that our path level of detail keeps it within our tolerance using a
  // few of its points) or some noise (so that our path level of detail can't do anything about it, see Note #7 of
  // pathLevelOfDetailUtils.ts), in a plotting area that is about as big as them.

  const CURVE_AREA: IGpuPlotArea = { ...AREA, xMin: -1, xMax: 1, yMin: -1, yMax: 1 };

  const curve = (nbOfPoints: number): [xValues: Float64Array, yValues: Float64Array] => {
    return [
      Float64Array.from({ length: nbOfPoints }, (_value, i) => Math.sin((60 * i) / nbOfPoints)),
      Float64Array.from({ length: nbOfPoints }, (_value, i) => Math.sin((80 * i) / nbOfPoints))
    ];
  };

  const noise = (nbOfPoints: number): [xValues: Float64Array, yValues: Float64Array] => {
    let state = 1;
    const random = (): number => {
      state = (state * 16807) % 2147483647;

      return 2 * (state / 2147483647) - 1;
    };

    return [Float64Array.from({ length: nbOfPoints }, random), Float64Array.from({ length: nbOfPoints }, random)];
  };

  const pathLevelPoints = (xValues: Float64Array, yValues: Float64Array, area: IGpuPlotArea): number[] => {
    // Return the points of the level of our path level of detail that we should draw for the given values and
    // plotting area (i.e. with tolerances of a quarter of a pixel), relative to their first point and as 32-bit
    // floats, i.e. what our renderer should upload.

    const nbOfPoints = Math.min(xValues.length, yValues.length);
    const lod = pathLevelOfDetailUtils.create();

    pathLevelOfDetailUtils.update(lod, xValues, yValues, nbOfPoints);

    const level = pathLevelOfDetailUtils.selectLevel(
      lod,
      xValues,
      yValues,
      (0.25 * (area.xMax - area.xMin)) / area.width,
      (0.25 * (area.yMax - area.yMin)) / area.height
    );

    return Array.from(level?.indices.subarray(0, level.count) ?? []).flatMap((index) => [
      Math.fround((xValues[index] as number) - (xValues[0] as number)),
      Math.fround((yValues[index] as number) - (yValues[0] as number))
    ]);
  };

  const selectionUploads = (fake: IFakeContext): number => {
    // Return the number of uploads that were made to our selection buffer (i.e. to any buffer but our first one, since
    // our selection buffer gets replaced when it needs to be bigger).

    let res = 0;
    let boundBuffer: unknown;

    for (const [name, args] of fake.calls) {
      if (name === 'bindBuffer' && args[0] === 'ARRAY_BUFFER') {
        boundBuffer = args[1];
      } else if (name === 'bufferSubData' && boundBuffer !== fake.buffers[0]) {
        ++res;
      }
    }

    return res;
  };

  it('only draws the points of a level of its path level of detail for the line of a smooth unsorted trace', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = curve(NB_OF_POINTS);

    trace.update(xValues, yValues);

    fake.calls.length = 0;

    const pointCounts: IGpuPlotPointCounts = { nbOfPoints: 0, nbOfDrawnPoints: 0 };

    renderer.render(
      createFakeTarget().context,
      CURVE_AREA,
      [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }],
      pointCounts
    );

    // The points of our level get uploaded to a separate buffer, from which our line gets drawn.

    const expectedPoints = pathLevelPoints(xValues, yValues, CURVE_AREA);
    const nbOfLevelPoints = expectedPoints.length / 2;

    expect(nbOfLevelPoints).toBeGreaterThan(0);
    expect(nbOfLevelPoints).toBeLessThan(NB_OF_POINTS / 10);
    expect(fake.buffers.length).toBe(2);
    expect(bufferPoints(fake, fake.buffers[1], expectedPoints.length)).toEqual(expectedPoints);
    expect(lineDraws(fake)).toEqual([[0, nbOfLevelPoints - 1]]);
    expect(pointCounts).toEqual({ nbOfPoints: NB_OF_POINTS, nbOfDrawnPoints: nbOfLevelPoints });
  });

  it('draws all the points of a noisy unsorted trace, and all the markers of an unsorted trace', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();

    // Our path level of detail has no level for our noise once it has enough points for its levels to be dropped.

    const nbOfPoints = pathLevelOfDetailUtils.MIN_NB_OF_POINTS_TO_DROP_LEVELS;
    const [xValues, yValues] = noise(nbOfPoints);

    expect(pathLevelPoints(xValues, yValues, CURVE_AREA)).toEqual([]);

    trace.update(xValues, yValues);

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, CURVE_AREA, [
      { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }
    ]);

    expect(fake.buffers.length).toBe(1);
    expect(lineDraws(fake)).toEqual([[0, nbOfPoints - 1]]);

    // Without a line (i.e. only markers), our path level of detail is not used either, even for a smooth trace.

    const [curveXValues, curveYValues] = curve(NB_OF_POINTS);

    trace.update(curveXValues, curveYValues);

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, CURVE_AREA, [
      { trace, color: '#f00', alpha: 1, lineWidth: 0, markerSize: 2 }
    ]);

    expect(fake.buffers.length).toBe(1);
    expect(lineDraws(fake)).toEqual([[0, NB_OF_POINTS]]);
  });

  it('only uploads the points of a level of its path level of detail again when they may have changed', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = curve(NB_OF_POINTS);
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];

    trace.update(xValues, yValues);
    renderer.render(createFakeTarget().context, CURVE_AREA, items);

    expect(selectionUploads(fake)).toBe(1);

    // Not again for the same level and points.

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, CURVE_AREA, items);

    expect(selectionUploads(fake)).toBe(0);

    // Again for another level (e.g., once zoomed in).

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, { ...CURVE_AREA, xMin: -0.1, xMax: 0.1 }, items);

    expect(selectionUploads(fake)).toBe(1);

    // Again for the same level if our points may have changed, i.e. if they got updated with a new view of the same
    // buffers (as opposed to the very same values, which are assumed not to have changed).

    fake.calls.length = 0;

    trace.update(xValues.subarray(0), yValues.subarray(0));
    renderer.render(createFakeTarget().context, { ...CURVE_AREA, xMin: -0.1, xMax: 0.1 }, items);

    expect(selectionUploads(fake)).toBe(1);

    // In full again for a selection of our (column) level of detail, if our points become sorted.

    const [sortedXValues, sortedYValues] = values(NB_OF_POINTS);

    fake.calls.length = 0;

    trace.update(sortedXValues, sortedYValues);
    renderer.render(createFakeTarget().context, LOD_AREA, items);

    const expectedPoints = selectedPoints(sortedXValues, sortedYValues, LOD_AREA);

    expect(bufferPoints(fake, fake.buffers.at(-1), expectedPoints.length)).toEqual(expectedPoints);
    expect(lineDraws(fake)).toEqual([[0, expectedPoints.length / 2 - 1]]);
  });

  it('rarely reallocates its selection buffer while a smooth unsorted trace keeps growing', () => {
    // A growing trace (e.g., while a simulation is running) gets more and more points in its path level, so our
    // selection buffer should grow geometrically rather than be reallocated every time.

    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xBuffer, yBuffer] = curve(2 * NB_OF_POINTS);
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];
    let nbOfSelectionBuffers = 0;

    for (let nbOfPoints = NB_OF_POINTS; nbOfPoints <= 2 * NB_OF_POINTS; nbOfPoints += NB_OF_POINTS / 20) {
      trace.update(xBuffer.subarray(0, nbOfPoints), yBuffer.subarray(0, nbOfPoints));

      fake.calls.length = 0;

      renderer.render(createFakeTarget().context, CURVE_AREA, items);

      nbOfSelectionBuffers += calls(fake, 'createBuffer').length;
    }

    expect(nbOfSelectionBuffers).toBeLessThanOrEqual(3);
  });

  it('uses the given path level of detail, if any, which it then does not count as its memory', () => {
    const { renderer } = createRenderer();
    const sharedPathLod = pathLevelOfDetailUtils.create();
    const sharingTrace = renderer.createTrace(undefined, sharedPathLod);
    const owningTrace = renderer.createTrace();
    const [xValues, yValues] = curve(NB_OF_POINTS);

    for (const trace of [sharingTrace, owningTrace]) {
      trace.update(xValues, yValues);
      renderer.render(createFakeTarget().context, CURVE_AREA, [
        { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }
      ]);
    }

    expect(sharedPathLod.count).toBe(NB_OF_POINTS);
    expect(owningTrace.memoryUsage().cpu - sharingTrace.memoryUsage().cpu).toBe(
      pathLevelOfDetailUtils.memoryUsage(sharedPathLod)
    );

    // Once disposed of, a trace forgets about the given path level of detail.

    sharingTrace.dispose();

    expect(sharingTrace.memoryUsage().cpu).toBe(0);
  });

  it('uploads the points of a level of its path level of detail again after its context got restored', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = curve(NB_OF_POINTS);
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];

    trace.update(xValues, yValues);
    renderer.render(createFakeTarget().context, CURVE_AREA, items);

    fake.canvas?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.canvas?.dispatchEvent(new Event('webglcontextrestored'));

    trace.update(xValues, yValues);
    renderer.render(createFakeTarget().context, CURVE_AREA, items);

    const expectedPoints = pathLevelPoints(xValues, yValues, CURVE_AREA);

    expect(fake.buffers.length).toBe(4);
    expect(bufferPoints(fake, fake.buffers[3], expectedPoints.length)).toEqual(expectedPoints);
  });

  it('only draws the points that are needed for the line of a trace with gaps among them, which remain gaps', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = values(NB_OF_POINTS);

    // Note: a gap may be due to a non-finite X value, or to a non-finite Y value, in which case its X value doesn't
    //       matter (i.e. it may not be sorted).

    xValues[3000] = Number.NaN;
    xValues[4000] = -1;
    yValues[4000] = Number.NaN;
    yValues[5000] = Number.NaN;
    yValues.fill(Number.POSITIVE_INFINITY, 7000, 7100);

    trace.update(xValues, yValues);

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, LOD_AREA, [
      { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }
    ]);

    const expectedPoints = selectedPoints(xValues, yValues, LOD_AREA);
    const nbOfSelectedPoints = expectedPoints.length / 2;

    expect(nbOfSelectedPoints).toBeLessThan(NB_OF_POINTS / 2);
    // Our gaps are uploaded as such, i.e. our gaps at points 3,000, 4,000, and 5,000, and our gap from point 7,000 to
    // 7,099, which is only selected once even though it spans two columns (of 50 points each), since a gap belongs to
    // the column of the finite point that follows it (see Note #8 of levelOfDetailUtils.ts).

    expect(expectedPoints.filter((value) => value === Math.fround(3.0e38)).length).toBe(2 * 4);
    expect(fake.buffers.length).toBe(2);
    expect(bufferPoints(fake, fake.buffers[1], expectedPoints.length)).toEqual(expectedPoints);
    expect(lineDraws(fake)).toEqual([[0, nbOfSelectedPoints - 1]]);
  });

  it('only uploads the part of its selection that changed', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [allXValues, allYValues] = values(2 * NB_OF_POINTS);
    const area = { ...LOD_AREA, xMax: 2 * NB_OF_POINTS };
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];
    const selectionUploads = (): unknown[][] => {
      return calls(fake, 'bufferSubData').map(([, offset, , , length]) => [(offset as number) / 8, length]);
    };

    trace.update(allXValues.subarray(0, NB_OF_POINTS), allYValues.subarray(0, NB_OF_POINTS));
    renderer.render(createFakeTarget().context, area, items);

    // Add some points (i.e. a continuation of our previous ones), so that only the end of our selection changes.

    const newXValues = allXValues.subarray(0, NB_OF_POINTS + 100);
    const newYValues = allYValues.subarray(0, NB_OF_POINTS + 100);
    const expectedPoints = selectedPoints(newXValues, newYValues, area);

    trace.update(newXValues, newYValues);

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, area, items);

    const [[firstChanged, nbOfValues]] = selectionUploads() as [[number, number]];

    expect(firstChanged).toBeGreaterThan(0);
    expect(nbOfValues).toBe(expectedPoints.length - 2 * firstChanged);
    expect(bufferPoints(fake, fake.buffers[1], expectedPoints.length)).toEqual(expectedPoints);

    // If nothing changed, then only the points of our last column get selected and uploaded again (since our last
    // point is always assumed to have possibly changed, see Note #6 of levelOfDetailUtils.ts).

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, area, items);

    const [[lastColumnStart, lastColumnNbOfValues]] = selectionUploads() as [[number, number]];

    expect(lastColumnNbOfValues).toBeLessThanOrEqual(8);
    expect(2 * lastColumnStart + lastColumnNbOfValues).toBe(expectedPoints.length);
    expect(bufferPoints(fake, fake.buffers[1], expectedPoints.length)).toEqual(expectedPoints);
  });

  it('selects (and uploads) its points again when they change', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];

    trace.update(...values(NB_OF_POINTS));
    renderer.render(createFakeTarget().context, LOD_AREA, items);

    // New points (i.e. not a continuation of our previous ones), with the same X values but different Y values.

    const [xValues, yValues] = values(NB_OF_POINTS, 1);
    const expectedPoints = selectedPoints(xValues, yValues, LOD_AREA);

    trace.update(xValues, yValues);
    renderer.render(createFakeTarget().context, LOD_AREA, items);

    expect(bufferPoints(fake, fake.buffers[1], expectedPoints.length)).toEqual(expectedPoints);
  });

  it('replaces its selection buffer when it needs a bigger one, and deletes it when disposed of', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = values(NB_OF_POINTS);
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];
    const widerArea = { ...LOD_AREA, width: 200 };

    trace.update(xValues, yValues);
    renderer.render(createFakeTarget().context, LOD_AREA, items);

    // A wider plotting area has more columns and therefore needs a bigger selection buffer, to which our selection
    // gets uploaded in full.

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, widerArea, items);

    const expectedPoints = selectedPoints(xValues, yValues, widerArea);

    expect(calls(fake, 'deleteBuffer')).toEqual([[fake.buffers[1]]]);
    expect(fake.buffers.length).toBe(3);
    expect(calls(fake, 'bufferSubData').map(([, offset, , , length]) => [offset, length])).toEqual([
      [0, expectedPoints.length]
    ]);
    expect(bufferPoints(fake, fake.buffers[2], expectedPoints.length)).toEqual(expectedPoints);

    // Disposing of our trace deletes both its buffers.

    fake.calls.length = 0;

    trace.dispose();

    expect(calls(fake, 'deleteBuffer')).toEqual([[fake.buffers[0]], [fake.buffers[2]]]);
  });

  it('uses the given level of detail, if any, and uploads its selection in full if another one was made in between', () => {
    const { renderer, fake } = createRenderer();
    const lod = levelOfDetailUtils.create();
    const trace = renderer.createTrace(lod);
    const [xValues, yValues] = values(NB_OF_POINTS);
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];

    trace.update(xValues, yValues);
    renderer.render(createFakeTarget().context, LOD_AREA, items);

    // Our trace uses the given level of detail, which it doesn't count as its own memory.

    expect(lod.count).toBe(NB_OF_POINTS);
    expect(lod.nbOfSelections).toBe(1);
    expect(trace.memoryUsage().cpu).toBe(0);

    // Another selection gets made in between (e.g., by the Canvas 2D renderer of a plot), so our next selection gets
    // uploaded in full, even though only its last column was selected again.

    levelOfDetailUtils.selectPoints(lod, xValues, yValues, 0, NB_OF_POINTS, LOD_AREA.xMin, LOD_AREA.xMax, 200);

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, LOD_AREA, items);

    const expectedPoints = selectedPoints(xValues, yValues, LOD_AREA);

    expect(lod.selection?.firstChanged).toBeGreaterThan(0);
    expect(calls(fake, 'bufferSubData').map(([, offset, , , length]) => [offset, length])).toEqual([
      [0, expectedPoints.length]
    ]);

    // Once disposed of, our trace stops using the given level of detail.

    trace.dispose();

    expect(lod.count).toBe(NB_OF_POINTS);
  });

  it('reports how much memory it uses, in memory and on the GPU', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = values(NB_OF_POINTS);

    expect(trace.memoryUsage()).toEqual({ cpu: 0, gpu: 0 });

    // Our buffer (which can hold all of our points) and, once rendered, our level of detail and selection buffer (which
    // can hold the maximum number of points that our level of detail may select, i.e. 4 per column plus 8).

    trace.update(xValues, yValues);

    expect(trace.memoryUsage()).toEqual({ cpu: 0, gpu: 8 * NB_OF_POINTS });

    renderer.render(createFakeTarget().context, LOD_AREA, [
      { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }
    ]);

    const lod = levelOfDetailUtils.create();

    levelOfDetailUtils.update(lod, xValues, yValues, NB_OF_POINTS);
    levelOfDetailUtils.selectPoints(lod, xValues, yValues, 0, NB_OF_POINTS, LOD_AREA.xMin, LOD_AREA.xMax, 200);

    expect(trace.memoryUsage()).toEqual({
      cpu: levelOfDetailUtils.memoryUsage(lod),
      gpu: 8 * NB_OF_POINTS + 8 * (4 * 200 + 8)
    });

    // Our buffers are gone once our context has been lost and restored.

    fake.canvas?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.canvas?.dispatchEvent(new Event('webglcontextrestored'));

    expect(trace.memoryUsage().gpu).toBe(0);
  });

  it('uploads its selection in full again after its context got restored', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const [xValues, yValues] = values(NB_OF_POINTS);
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];

    trace.update(xValues, yValues);
    renderer.render(createFakeTarget().context, LOD_AREA, items);

    fake.canvas?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.canvas?.dispatchEvent(new Event('webglcontextrestored'));

    expect(renderer.isAvailable()).toBe(true);

    // Our buffers belonged to our lost context, so new ones get created (without deleting our old ones) and our points
    // and selection get uploaded to them in full.

    fake.calls.length = 0;

    trace.update(xValues, yValues);
    renderer.render(createFakeTarget().context, LOD_AREA, items);

    const expectedPoints = selectedPoints(xValues, yValues, LOD_AREA);

    expect(calls(fake, 'deleteBuffer')).toEqual([]);
    expect(fake.buffers.length).toBe(4);
    expect(bufferPoints(fake, fake.buffers[3], expectedPoints.length)).toEqual(expectedPoints);

    // Disposing of our trace only deletes its new buffers.

    fake.calls.length = 0;

    trace.dispose();

    expect(calls(fake, 'deleteBuffer')).toEqual([[fake.buffers[2]], [fake.buffers[3]]]);
  });

  it("doesn't delete the buffers of its lost context when disposed of", () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();

    trace.update(...values(NB_OF_POINTS));
    renderer.render(createFakeTarget().context, LOD_AREA, [
      { trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }
    ]);

    fake.canvas?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.canvas?.dispatchEvent(new Event('webglcontextrestored'));

    fake.calls.length = 0;

    trace.dispose();

    expect(fake.buffers.length).toBe(2);
    expect(calls(fake, 'deleteBuffer')).toEqual([]);
  });
});

// Context loss.

describe('context loss', () => {
  it('is not available while its context is lost, and lets its listeners know when it gets lost and restored', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];
    const listener = mock(() => {});
    const otherListener = mock(() => {});
    const xValues = Float64Array.from([1, 2, 3]);

    trace.update(xValues, xValues);
    renderer.onAvailabilityChange(listener);
    renderer.onAvailabilityChange(otherListener)();

    // Lose our context, which we want to be restored.

    const lostEvent = new Event('webglcontextlost', { cancelable: true });

    fake.canvas?.dispatchEvent(lostEvent);

    expect(lostEvent.defaultPrevented).toBe(true);
    expect(renderer.isAvailable()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(renderer.render(createFakeTarget().context, AREA, items)).toBe(false);

    // Restore our context.

    fake.canvas?.dispatchEvent(new Event('webglcontextrestored'));

    expect(renderer.isAvailable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(otherListener).not.toHaveBeenCalled();

    // Our trace's buffer is gone, so our trace doesn't get rendered until it gets updated, at which point all of its
    // points get uploaded (to a new buffer), even though they are a continuation of the previous ones.

    fake.calls.length = 0;

    renderer.render(createFakeTarget().context, AREA, items);

    expect(calls(fake, 'drawArraysInstanced')).toEqual([]);

    trace.update(xValues, xValues);

    expect(fake.buffers.length).toBe(2);
    expect(calls(fake, 'bufferSubData').map(([, offset, , , length]) => [offset, length])).toEqual([[0, 6]]);

    renderer.render(createFakeTarget().context, AREA, items);

    expect(calls(fake, 'drawArraysInstanced')).toEqual([['TRIANGLE_STRIP', 0, 4, 2]]);

    // Disposing of our trace doesn't delete its old buffer, which belonged to our lost context.

    fake.calls.length = 0;

    trace.dispose();

    expect(calls(fake, 'deleteBuffer')).toEqual([[fake.buffers[1]]]);
  });

  it('is not available as soon as its context is lost, even before being told about it', () => {
    const { renderer, fake } = createRenderer();

    expect(renderer.isAvailable()).toBe(true);

    fake.lost = true;

    expect(renderer.isAvailable()).toBe(false);
  });

  it('is not available if its context cannot be restored', () => {
    const { renderer, fake } = createRenderer();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});

    expect(renderer.isAvailable()).toBe(true);

    fake.canvas?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.failures.add('createShader');
    fake.canvas?.dispatchEvent(new Event('webglcontextrestored'));

    expect(renderer.isAvailable()).toBe(false);
    expect(consoleError.mock.calls[0]?.[0]).toBe('@opencor/plot: the GPU plot renderer could not be restored:');
  });
});
