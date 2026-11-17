import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  createGpuPlotRenderer,
  type IGpuPlotArea,
  type IGpuPlotRenderer,
  type IGpuPlotTrace,
  isPrecise
} from './gpuPlotRenderer';

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

const createFake2dContext = (): CanvasRenderingContext2D & { nbOfParsedColors: number } => {
  const res = {
    fillStyle: '',
    nbOfParsedColors: 0,
    clearRect: () => {},
    fillRect: () => {},
    getImageData: () => {
      ++res.nbOfParsedColors;

      return { data: COLORS[res.fillStyle] ?? [0, 0, 0, 0] };
    }
  };

  return res as unknown as CanvasRenderingContext2D & { nbOfParsedColors: number };
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

    fake.lost = true;

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
});

// render().

describe('render()', () => {
  const traceWith = (renderer: IGpuPlotRenderer, nbOfPoints: number): IGpuPlotTrace => {
    const res = renderer.createTrace();
    const xValues = Float64Array.from({ length: nbOfPoints }, (_value, i) => i);

    res.update(xValues, xValues.map(Math.sin));

    return res;
  };

  it('renders the lines and markers of some traces, and copies them to the given canvas', () => {
    const { renderer, fake } = createRenderer();
    const target = createFakeTarget();
    const items = [
      { trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 4, markerSize: 0 },
      { trace: traceWith(renderer, 7), color: 'rgb(0 0 255 / 50%)', alpha: 0.5, lineWidth: 2, markerSize: 6 }
    ];

    fake.calls.length = 0;

    expect(renderer.render(target.context, AREA, items)).toBe(true);

    // Our region is our plotting area extended by half the width of our widest line, i.e. 2 pixels.

    expect(calls(fake, 'viewport')).toEqual([[0, 0, 104, 54]]);
    expect(fake.canvas?.width).toBe(104);
    expect(fake.canvas?.height).toBe(54);
    expect(calls(fake, 'texImage2D')).toEqual([['TEXTURE_2D', 0, 'R8', 104, 54, 0, 'RED', 'UNSIGNED_BYTE', null]]);

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

    // The compositing of our traces, using their (premultiplied) colour and opacity.

    const alpha = (128 / 255) * 0.5;

    expect(calls(fake, 'drawArrays')).toEqual([
      ['TRIANGLES', 0, 3],
      ['TRIANGLES', 0, 3]
    ]);
    expect(calls(fake, 'uniform4f')).toEqual([
      ['uColor', 1, 0, 0, 1],
      ['uColor', 0, 0, alpha, alpha]
    ]);

    // The copy of our region to our target.

    expect(target.drawImageCalls).toEqual([[fake.canvas, 0, 0, 104, 54, 8, 18, 104, 54]]);
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

  it('only ever grows its canvas and coverage texture', () => {
    const { renderer, fake } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 0, markerSize: 0 }];

    renderer.render(createFakeTarget().context, AREA, items);
    renderer.render(createFakeTarget().context, { ...AREA, width: 50, height: 100 }, items);
    renderer.render(createFakeTarget().context, { ...AREA, width: 20, height: 20 }, items);

    expect(calls(fake, 'texImage2D').map(([, , , width, height]) => [width, height])).toEqual([
      [100, 50],
      [100, 100]
    ]);
    expect([fake.canvas?.width, fake.canvas?.height]).toEqual([100, 100]);
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

    expect(calls(fake, 'uniform4f')).toEqual([['uColor', 0, 0, 0, 1]]);
  });

  it('fails if its context gets lost while rendering', () => {
    const { renderer, fake } = createRenderer();
    const items = [{ trace: traceWith(renderer, 5), color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];

    fake.lost = true;

    expect(renderer.render(createFakeTarget().context, AREA, items)).toBe(false);
  });
});

// Context loss.

describe('context loss', () => {
  it('is not available while its context is lost, and lets its listeners know when it gets restored', () => {
    const { renderer, fake } = createRenderer();
    const trace = renderer.createTrace();
    const items = [{ trace, color: '#f00', alpha: 1, lineWidth: 1, markerSize: 0 }];
    const listener = mock(() => {});
    const otherListener = mock(() => {});
    const xValues = Float64Array.from([1, 2, 3]);

    trace.update(xValues, xValues);
    renderer.onRestored(listener);
    renderer.onRestored(otherListener)();

    // Lose our context, which we want to be restored.

    const lostEvent = new Event('webglcontextlost', { cancelable: true });

    fake.canvas?.dispatchEvent(lostEvent);

    expect(lostEvent.defaultPrevented).toBe(true);
    expect(renderer.isAvailable()).toBe(false);
    expect(renderer.render(createFakeTarget().context, AREA, items)).toBe(false);

    // Restore our context.

    fake.canvas?.dispatchEvent(new Event('webglcontextrestored'));

    expect(renderer.isAvailable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
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
