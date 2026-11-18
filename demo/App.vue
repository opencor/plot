<template>
  <div class="demo">
    <main class="demo-main" :style="gridStyle">
      <div v-for="(data, index) in datasets" :key="index" class="demo-plot">
        <OpenCORPlot :ref="(plot) => setPlotRef(plot, index)"
          :data="data"
          :theme="instanceTheme(index)"
          :renderer="renderer"
          :levelOfDetail="levelOfDetail"
          :showLegend="showLegend"
          :customContextMenu="customContextMenu"
          :margins="sharedMargins ? margins : undefined"
          @contextMenu="(event) => onContextMenu(event, index)"
          @csvExport="onCsvExport"
          @marginsUpdated="(newMargins) => onMarginsUpdated(newMargins, index)"
        />
      </div>
    </main>
    <aside class="demo-sidebar">
      <h1>OpenCOR Plot</h1>
      <section>
        <h2>Status</h2>
        <!--
        Note: our status has a fixed number of rows, each of which is a single line (with an ellipsis and a tooltip if
              its value is too long), so that it never makes the rest of our sidebar move.
        -->
        <dl class="demo-status">
          <template v-for="row in statusRows" :key="row.term">
            <dt>{{ row.term }}</dt>
            <dd :title="row.value">{{ row.value || '—' }}</dd>
          </template>
        </dl>
      </section>
      <section>
        <h2>Data</h2>
        <label class="demo-field">
          <span>Kind</span>
          <select v-model="kind">
            <option v-for="(name, value) in DATA_KINDS" :key="value" :value="value">{{ name }}</option>
          </select>
        </label>
        <label class="demo-field">
          <span>Traces</span>
          <select v-model.number="nbOfTraces">
            <option v-for="value in NBS_OF_TRACES" :key="value" :value="value"
              :disabled="tooManyPoints(nbOfInstances, value, nbOfPoints)"
            >
              {{ formatNumber(value) }}
            </option>
          </select>
        </label>
        <label class="demo-field">
          <span>Points per trace</span>
          <select v-model.number="nbOfPoints">
            <option v-for="value in NBS_OF_POINTS" :key="value" :value="value"
              :disabled="tooManyPoints(nbOfInstances, nbOfTraces, value)"
            >
              {{ formatNumber(value) }}
            </option>
          </select>
        </label>
        <label class="demo-field">
          <span>Instances</span>
          <select v-model.number="nbOfInstances">
            <option v-for="value in NBS_OF_INSTANCES" :key="value" :value="value"
              :disabled="tooManyPoints(value, nbOfTraces, nbOfPoints)"
            >
              {{ formatNumber(value) }}
            </option>
          </select>
        </label>
      </section>
      <section>
        <h2>Live</h2>
        <label class="demo-check">
          <input v-model="live" type="checkbox" />
          Plot live
        </label>
        <label class="demo-field">
          <span>Points per second</span>
          <select v-model.number="nbOfPointsPerSecond" :disabled="!live">
            <option v-for="value in NBS_OF_POINTS_PER_SECOND" :key="value" :value="value">{{ formatNumber(value) }}</option>
          </select>
        </label>
        <label class="demo-field">
          <span>X range</span>
          <select v-model="xRange" :disabled="!live">
            <option value="fixed">Fixed</option>
            <option value="growing">Growing</option>
          </select>
        </label>
      </section>
      <section>
        <h2>Plot</h2>
        <label class="demo-field">
          <span>Layout</span>
          <select v-model="layout">
            <option value="grid">Grid</option>
            <option value="stacked">Stacked</option>
          </select>
        </label>
        <label class="demo-check">
          <input v-model="sharedMargins" type="checkbox" />
          Shared margins
        </label>
        <label class="demo-field">
          <span>Theme</span>
          <select v-model="theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
        <label class="demo-field">
          <span>Renderer</span>
          <select v-model="renderer">
            <option value="auto">Auto</option>
            <option value="canvas">Canvas 2D</option>
            <option value="webgl">WebGL</option>
          </select>
        </label>
        <label class="demo-check">
          <input v-model="levelOfDetail" type="checkbox" />
          Level of detail
        </label>
        <label class="demo-check">
          <input v-model="showLegend" type="checkbox" />
          Legend
        </label>
        <label class="demo-check">
          <input v-model="customContextMenu" type="checkbox" />
          Custom context menu
        </label>
      </section>
      <section>
        <h2>Testing</h2>
        <button type="button" :disabled="benchmarking || !datasets.length" @click="runBenchmark">Benchmark</button>
        <button type="button" :disabled="renderer === 'canvas' || webGlContextLost" @click="onLoseWebGlContext">Lose WebGL context</button>
      </section>
    </aside>
    <!--
    Note: a (very) basic custom context menu, to show how a consumer can use its own context menu (see onContextMenu()).
    -->
    <ul v-if="customMenu" ref="customMenuRef" class="demo-custom-menu" tabindex="-1"
      :style="{ left: `${customMenu.x}px`, top: `${customMenu.y}px` }"
      @keydown.escape="hideCustomMenu"
    >
      <li v-for="(item, index) in customMenu.items" :key="index">
        <hr v-if="!item.command" />
        <button v-else type="button" @click="onCustomMenuItemClick(item.command)">{{ item.label }}</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import * as vue from 'vue';

import OpenCORPlot, {
  type IContextMenuItem,
  type IPlotContextMenuEvent,
  type IPlotCsvExportEvent,
  type IPlotData,
  type IPlotMargins,
  type PlotActiveRenderer,
  type PlotRenderer,
  type PlotTheme
} from '../index';
import { DATA_KINDS, type DataKind, plotData } from './data';
import { loseWebGlContext, restoreWebGlContext } from './webgl';

type PlotInstance = InstanceType<typeof OpenCORPlot>;

// Our options.

const NBS_OF_TRACES = [1, 3, 10, 30, 100];
const NBS_OF_POINTS = [10, 100, 1000, 10000, 100000, 1000000, 10000000];
const NBS_OF_INSTANCES = [1, 2, 4, 9, 16, 25, 36, 49];
const NBS_OF_POINTS_PER_SECOND = [10, 100, 1000, 10000, 100000, 1000000];

const kind = vue.ref<DataKind>('smooth');
const nbOfTraces = vue.ref<number>(3);
const nbOfPoints = vue.ref<number>(1000);
const nbOfInstances = vue.ref<number>(1);
const theme = vue.ref<PlotTheme | 'mixed'>('mixed');
const renderer = vue.ref<PlotRenderer>('auto');
const levelOfDetail = vue.ref<boolean>(true);
const showLegend = vue.ref<boolean>(true);
const customContextMenu = vue.ref<boolean>(false);
const layout = vue.ref<'grid' | 'stacked'>('grid'); // Whether our instances are in a grid or stacked (in one column).
const sharedMargins = vue.ref<boolean>(true); // Whether our instances share their margins (see onMarginsUpdated()).
const live = vue.ref<boolean>(false);
const nbOfPointsPerSecond = vue.ref<number>(1000);
const xRange = vue.ref<'fixed' | 'growing'>('fixed');

const formatNumber = (value: number): string => {
  return value.toLocaleString('en');
};

const percentage = (ratio: number): string => {
  return ratio.toLocaleString('en', { style: 'percent', maximumSignificantDigits: 2 });
};

// Whether the system uses dark mode, which we keep track of so that our mixed theme can alternate between the theme of
// the system and the other one.

const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const systemUsesDarkMode = vue.ref<boolean>(darkModeQuery.matches);

const onDarkModeChange = (event: MediaQueryListEvent): void => {
  systemUsesDarkMode.value = event.matches;
};

darkModeQuery.addEventListener('change', onDarkModeChange);

const instanceTheme = (index: number): PlotTheme => {
  // Return the theme of the given instance, alternating between the theme of the system (for our first instance) and
  // the other one if our theme is mixed.

  if (theme.value === 'mixed') {
    return index % 2 ? (systemUsesDarkMode.value ? 'light' : 'dark') : 'system';
  }

  return theme.value;
};

// Our data, i.e. the data of each of our instances.
// Note #1: we limit the total number of points that we plot since each point takes 16 bytes (8 bytes for its X value,
//          which our traces share if possible, and 8 bytes for its Y value), e.g. 100,000,000 points take at least
//          800 MB. So, the options that would exceed that limit are disabled.
// Note #2: we let our status get painted before generating our data since it may take a while.

const MAX_TOTAL_NB_OF_POINTS = 100000000;

const tooManyPoints = (instances: number, traces: number, points: number): boolean => {
  return instances * traces * points > MAX_TOTAL_NB_OF_POINTS;
};

const datasets = vue.shallowRef<IPlotData[]>([]);
const dataStatus = vue.ref<string>('');
let generatedDatasets: IPlotData[] = [];
let dataGeneration = 0;

const nextPaint = (): Promise<void> => {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
};

const generateData = async (): Promise<void> => {
  const generation = ++dataGeneration;
  const totalNbOfPoints = nbOfInstances.value * nbOfTraces.value * nbOfPoints.value;

  // Release our current data before generating our new data, so that we don't need memory for both.

  stopLive();

  datasets.value = [];
  generatedDatasets = [];
  dataStatus.value = 'Generating...';

  await nextPaint();

  if (generation !== dataGeneration) {
    return;
  }

  const startTime = performance.now();

  generatedDatasets = Array.from({ length: nbOfInstances.value }, (_value, instance) =>
    plotData(kind.value, nbOfTraces.value, nbOfPoints.value, instance)
  );
  dataStatus.value = `${formatNumber(totalNbOfPoints)} points in ${formatNumber(Math.round(performance.now() - startTime))} ms`;

  showData();
};

// Live updating, i.e. our data gets plotted as if it was being generated (e.g., by a simulation), at the given number
// of points per second (per trace), starting again after a short pause once all of it has been plotted.
// Note #1: the X and Y values of a trace are views of the same buffers as before (i.e. those of our generated data),
//          only longer, i.e. they are a continuation of their previous values (see traceValues.ts).
// Note #2: our X range is either the range of our data so far (i.e. it grows) or the range of all of our data (i.e. it
//          is fixed), like a simulation that is plotted for its whole duration.

const LIVE_PAUSE = 1000; // Pause (in milliseconds) before starting again, once all of our data has been plotted.

let liveFrameId = 0;
let liveNbOfPoints = 0; // Number of points per trace that we have plotted so far.
let liveTotalNbOfPoints = 0; // Number of points per trace that we will have plotted in the end.
const liveStatus = vue.ref<string>('');

const xAxisRange = (data: IPlotData): [number, number] => {
  // Return the range of the X values of all the traces of the given data.

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const xValues of new Set(data.traces.map((trace) => trace.x))) {
    for (const x of xValues) {
      if (x < min) {
        min = x;
      }

      if (x > max) {
        max = x;
      }
    }
  }

  return min <= max ? [min, max] : [0, 1];
};

const liveDatasets = (nbOfPoints: number, xAxisRanges: ([number, number] | undefined)[]): IPlotData[] => {
  // Return our generated data, but with only the given number of points per trace, making sure that our traces still
  // share their X values (since our GPU plot renderer handles each trace separately anyway, but it's what a consumer
  // would do).

  return generatedDatasets.map((data, instance) => {
    const xViews = new Map<Float64Array, Float64Array>();

    return {
      ...data,
      xAxisRange: xAxisRanges[instance],
      traces: data.traces.map((trace) => {
        let x = xViews.get(trace.x);

        if (!x) {
          x = trace.x.subarray(0, nbOfPoints);

          xViews.set(trace.x, x);
        }

        return { ...trace, x, y: trace.y.subarray(0, nbOfPoints) };
      })
    };
  });
};

const stopLive = (): void => {
  cancelAnimationFrame(liveFrameId);

  liveFrameId = 0;
  liveStatus.value = '';
};

const startLive = (): void => {
  stopLive();

  const totalNbOfPoints = nbOfPoints.value;
  const pointsPerMillisecond = nbOfPointsPerSecond.value / 1000;
  const xAxisRanges = generatedDatasets.map((data) => (xRange.value === 'fixed' ? xAxisRange(data) : undefined));
  let startTime = performance.now();

  liveNbOfPoints = -1;
  liveTotalNbOfPoints = totalNbOfPoints;

  const onFrame = (time: number): void => {
    // Start again, if all of our data has been plotted and we have paused long enough.

    let elapsedTime = time - startTime;

    if (elapsedTime > totalNbOfPoints / pointsPerMillisecond + LIVE_PAUSE) {
      startTime = time;
      elapsedTime = 0;
    }

    // Plot our data so far, if we have new points.

    const newNbOfPoints = Math.min(totalNbOfPoints, Math.floor(elapsedTime * pointsPerMillisecond));

    if (newNbOfPoints !== liveNbOfPoints) {
      liveNbOfPoints = newNbOfPoints;

      datasets.value = liveDatasets(newNbOfPoints, xAxisRanges);
    }

    liveFrameId = requestAnimationFrame(onFrame);
  };

  liveFrameId = requestAnimationFrame(onFrame);
};

const showData = (): void => {
  // Show our generated data, either all at once or live.

  if (live.value) {
    startLive();
  } else {
    stopLive();

    datasets.value = generatedDatasets;
  }
};

vue.watch([kind, nbOfTraces, nbOfPoints, nbOfInstances], generateData, { immediate: true });

vue.watch([live, nbOfPointsPerSecond, xRange], () => {
  if (generatedDatasets.length) {
    showData();
  }
});

// Our instances, laid out in a grid that is as square as possible.

const plotRefs: (PlotInstance | null)[] = [];

const setPlotRef = (plot: unknown, index: number): void => {
  plotRefs[index] = plot as PlotInstance | null;
};

const gridStyle = vue.computed(() => {
  // Return the style of our grid, i.e. one column if our instances are stacked or, otherwise, as many columns as needed
  // for our grid to be as square as possible, and as many rows as needed for all of our instances.

  const nbOfColumns = layout.value === 'stacked' ? 1 : Math.ceil(Math.sqrt(datasets.value.length));
  const nbOfRows = Math.ceil(datasets.value.length / Math.max(1, nbOfColumns));

  return {
    gridTemplateColumns: `repeat(${nbOfColumns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${nbOfRows}, minmax(0, 1fr))`
  };
});

// Shared margins, i.e. the biggest natural margins of our instances, which we give to all of them (if they are to share
// their margins), so that their plotting areas are aligned (e.g., when they are stacked).
// Note: an instance always emits its natural margins (i.e. the margins that it needs), whether or not it is given some
//       shared margins (see updateMarginsAsync() in PlotWidget.vue).

const naturalMargins: (IPlotMargins | undefined)[] = []; // Natural margins of our instances.
const margins = vue.shallowRef<IPlotMargins | undefined>(); // Shared margins of our instances.

const onMarginsUpdated = (newMargins: IPlotMargins, index: number): void => {
  // Keep track of the natural margins of the given instance and update our shared margins, if needed (i.e. only if
  // they have changed, so that our instances don't get relaid out for nothing).

  naturalMargins[index] = newMargins;

  let left = 0;
  let right = 0;

  for (const instanceMargins of naturalMargins.slice(0, datasets.value.length)) {
    left = Math.max(left, instanceMargins?.left ?? 0);
    right = Math.max(right, instanceMargins?.right ?? 0);
  }

  if (margins.value?.left !== left || margins.value?.right !== right) {
    margins.value = { left, right };
  }
};

// Our frame rate, the renderer(s) that our instances actually use to draw their traces, and the number of points that
// they actually draw compared to their number of points (i.e. without level of detail), which we update twice a second
// (rather than reactively, which would be costly with many instances).

const ACTIVE_RENDERER_NAMES: Record<PlotActiveRenderer, string> = {
  canvas: 'Canvas 2D',
  webgl: 'WebGL',
  none: 'nothing (WebGL is not available)'
};
const FPS_UPDATE_INTERVAL = 500;

const fps = vue.ref<number>(0);
const activeRenderers = vue.ref<string>('');
const plottedPoints = vue.ref<string>('');
const drawnPoints = vue.ref<string>('');
let fpsFrameId = 0;

const updateDrawingStatus = (): void => {
  const counts = new Map<PlotActiveRenderer, number>();
  let nbOfPoints = 0;
  let nbOfDrawnPoints = 0;

  for (const plot of plotRefs.slice(0, datasets.value.length)) {
    if (plot) {
      const pointCounts = plot.pointCounts();

      counts.set(plot.activeRenderer, (counts.get(plot.activeRenderer) ?? 0) + 1);

      nbOfPoints += pointCounts.nbOfPoints;
      nbOfDrawnPoints += pointCounts.nbOfDrawnPoints;
    }
  }

  if (liveFrameId) {
    liveStatus.value = `${formatNumber(liveNbOfPoints)} of ${formatNumber(liveTotalNbOfPoints)} per trace`;
  }

  plottedPoints.value = formatNumber(nbOfPoints);
  drawnPoints.value = `${formatNumber(nbOfDrawnPoints)}${nbOfPoints ? ` (${percentage(nbOfDrawnPoints / nbOfPoints)})` : ''}`;

  activeRenderers.value =
    counts.size === 1
      ? ACTIVE_RENDERER_NAMES[counts.keys().next().value as PlotActiveRenderer]
      : [...counts].map(([name, count]) => `${ACTIVE_RENDERER_NAMES[name]} (${count})`).join(', ');
};

vue.onMounted(() => {
  let nbOfFrames = 0;
  let startTime = performance.now();

  const onFrame = (time: number): void => {
    ++nbOfFrames;

    if (time - startTime >= FPS_UPDATE_INTERVAL) {
      fps.value = Math.round((1000 * nbOfFrames) / (time - startTime));
      nbOfFrames = 0;
      startTime = time;

      updateDrawingStatus();
    }

    fpsFrameId = requestAnimationFrame(onFrame);
  };

  fpsFrameId = requestAnimationFrame(onFrame);
});

vue.onBeforeUnmount(() => {
  darkModeQuery.removeEventListener('change', onDarkModeChange);
  cancelAnimationFrame(fpsFrameId);
  clearTimeout(webGlTimeoutId);

  stopLive();
  stopBenchmark();
});

// Benchmark, i.e. we zoom all of our instances in (up to BENCHMARK_MAX_ZOOM times) and then out again, over and over,
// for a few seconds, so that they get redrawn every frame (both when most and when few of their points are visible),
// and we then report our frame rate and how long it takes our instances to redraw themselves.
// Note #1: our frame rate is capped by the refresh rate of the display (e.g., 60 FPS), so the time it takes our
//          instances to redraw themselves is what tells us how much headroom we have.
// Note #2: our instances redraw themselves in their requestAnimationFrame() callbacks, which they request when they
//          get zoomed. So, every frame, we zoom them from a requestAnimationFrame() callback (onFrameEnd()) that we
//          request after that (so that it gets called after theirs in the next frame) and that is preceded by another
//          one (onFrameStart()) that we request before that (so that it gets called before theirs in the next frame).
//          Their redraw time is then the time between the start of onFrameStart() and the start of onFrameEnd(), plus
//          the time it took to zoom them (in case they also do some work then).
// Note #3: WebGL draws asynchronously, so the GPU time of a frame is not (fully) included in the redraw time of our
//          instances (but it limits our frame rate if our frame rate is not capped).
// Note #4: we zoom our instances by sending wheel events to them (i.e. to the element of uPlot that handles them), and
//          we reset their zoom once we are done by sending them a "0" key press (i.e. to their plotting area).

const BENCHMARK_DURATION = 5000; // Duration (in milliseconds) of our benchmark.
const BENCHMARK_MAX_ZOOM = 100; // Maximum zoom of our benchmark.
const BENCHMARK_WHEEL_DELTA = 20; // Biggest wheel delta that our plot accounts for, i.e. a zoom factor of e^0.1.
const BENCHMARK_ZOOM_STEPS = Math.round(10 * Math.log(BENCHMARK_MAX_ZOOM)); // Number of wheel events to zoom in fully.

const benchmarking = vue.ref<boolean>(false); // Whether we are running our benchmark.
const benchmarkStatus = vue.ref<string>(''); // Status of our benchmark, i.e. its progress or our frame rate.
const benchmarkRedrawStatus = vue.ref<string>(''); // Redraw time of our instances during our benchmark.
let benchmarkFrameStartId = 0; // Id of our next onFrameStart() callback.
let benchmarkFrameEndId = 0; // Id of our next onFrameEnd() callback.

const stopBenchmark = (): void => {
  // Stop our benchmark, if it is running.

  cancelAnimationFrame(benchmarkFrameStartId);
  cancelAnimationFrame(benchmarkFrameEndId);

  benchmarkFrameStartId = 0;
  benchmarkFrameEndId = 0;
  benchmarking.value = false;
};

const percentile = (values: number[], fraction: number): number => {
  // Return the given percentile (as a fraction) of the given values.

  const sortedValues = [...values].sort((value1, value2) => value1 - value2);

  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length))] ?? 0;
};

const runBenchmark = (): void => {
  // Run our benchmark (see above).

  stopBenchmark();

  const overs = [...document.querySelectorAll<HTMLElement>('.demo-plot .u-over')];
  const redrawDurations: number[] = [];
  let startTime = -1;
  let frameStartTime = 0;
  let zoomDuration = 0;
  let nbOfFrames = 0;
  let zoomStep = 0;

  benchmarking.value = true;
  benchmarkStatus.value = 'Running...';
  benchmarkRedrawStatus.value = '';

  const zoom = (): void => {
    // Zoom our instances in or out, and keep track of how long it took.

    const zoomStartTime = performance.now();
    const zoomIn = Math.floor(zoomStep / BENCHMARK_ZOOM_STEPS) % 2 === 0;

    for (const over of overs) {
      const rect = over.getBoundingClientRect();

      over.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: zoomIn ? -BENCHMARK_WHEEL_DELTA : BENCHMARK_WHEEL_DELTA,
          clientX: rect.x + 0.5 * rect.width,
          clientY: rect.y + 0.5 * rect.height,
          bubbles: true,
          cancelable: true
        })
      );
    }

    ++zoomStep;

    zoomDuration = performance.now() - zoomStartTime;
  };

  const finish = (time: number): void => {
    // Stop our benchmark, reset the zoom of our instances, and report our results.

    stopBenchmark();

    for (const plotArea of document.querySelectorAll<HTMLElement>('.demo-plot .plot-area')) {
      plotArea.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true, cancelable: true }));
    }

    const averageRedrawDuration =
      redrawDurations.reduce((sum, value) => sum + value, 0) / Math.max(1, redrawDurations.length);

    benchmarkStatus.value = `${Math.round((1000 * nbOfFrames) / (time - startTime))} FPS`;
    benchmarkRedrawStatus.value = `${averageRedrawDuration.toFixed(1)} ms (95%: ${percentile(redrawDurations, 0.95).toFixed(1)} ms)`;
  };

  const onFrameStart = (time: number): void => {
    // Start a new frame, unless we are done (see Note #2 above).

    if (startTime < 0) {
      startTime = time;
    } else if (time - startTime >= BENCHMARK_DURATION) {
      finish(time);

      return;
    }

    ++nbOfFrames;

    frameStartTime = performance.now();
    benchmarkFrameStartId = requestAnimationFrame(onFrameStart);
  };

  const onFrameEnd = (): void => {
    // Keep track of how long it took our instances to redraw themselves (but not for our first frame, since we haven't
    // zoomed them yet), and zoom them again (see Note #2 above).

    if (nbOfFrames > 1) {
      redrawDurations.push(performance.now() - frameStartTime + zoomDuration);
    }

    zoom();

    benchmarkFrameEndId = requestAnimationFrame(onFrameEnd);
  };

  benchmarkFrameStartId = requestAnimationFrame(onFrameStart);
  benchmarkFrameEndId = requestAnimationFrame(onFrameEnd);
};

// Loss of our WebGL context, which we restore after a while, so that we can see our instances fall back to drawing
// their traces using Canvas 2D (or not at all if our renderer is WebGL) and then use WebGL again (see webgl.ts).

const WEBGL_CONTEXT_LOSS_DURATION = 3000; // Duration (in milliseconds) for which we lose our WebGL context.
const WEBGL_STATUS_DURATION = 2000; // Duration (in milliseconds) for which we show that our WebGL context is restored.

const webGlContextLost = vue.ref<boolean>(false); // Whether we have lost our WebGL context.
const webGlStatus = vue.ref<string>(''); // Status of our WebGL context, if we have lost it or just restored it.
let webGlTimeoutId: ReturnType<typeof setTimeout> | undefined; // Id of our timeout to restore or clear our status.

const onLoseWebGlContext = (): void => {
  // Lose our WebGL context, if it has been created (i.e. if WebGL has been used), and restore it after a while.

  clearTimeout(webGlTimeoutId);

  if (!loseWebGlContext()) {
    webGlStatus.value = 'Not used';
    webGlTimeoutId = setTimeout(() => {
      webGlStatus.value = '';
    }, WEBGL_STATUS_DURATION);

    return;
  }

  webGlContextLost.value = true;
  webGlStatus.value = `Lost (restoring it in ${WEBGL_CONTEXT_LOSS_DURATION / 1000} s)`;

  webGlTimeoutId = setTimeout(() => {
    restoreWebGlContext();

    webGlContextLost.value = false;
    webGlStatus.value = 'Restored';

    webGlTimeoutId = setTimeout(() => {
      webGlStatus.value = '';
    }, WEBGL_STATUS_DURATION);
  }, WEBGL_CONTEXT_LOSS_DURATION);
};

// CSV export progress.

const csvExportStatus = vue.ref<string>('');

const onCsvExport = (event: IPlotCsvExportEvent): void => {
  if (event.type === 'started') {
    csvExportStatus.value = 'Exporting...';
  } else if (event.type === 'progress') {
    csvExportStatus.value = `Exporting... ${event.percent}%`;
  } else {
    csvExportStatus.value = event.success ? 'Exported' : 'Failed';

    setTimeout(() => {
      csvExportStatus.value = '';
    }, 2000);
  }
};

// Our status, i.e. what we show at the top of our sidebar.

const statusRows = vue.computed(() => [
  { term: 'Frame rate', value: `${fps.value} FPS` },
  { term: 'Drawn using', value: activeRenderers.value },
  { term: 'Points', value: plottedPoints.value },
  { term: 'Drawn points', value: drawnPoints.value },
  { term: 'Data', value: dataStatus.value },
  { term: 'Live', value: liveStatus.value },
  { term: 'Benchmark', value: benchmarkStatus.value },
  { term: 'Redraw time', value: benchmarkRedrawStatus.value },
  { term: 'WebGL context', value: webGlStatus.value },
  { term: 'CSV export', value: csvExportStatus.value }
]);

// Custom context menu, which lists our items (including those of submenus) as buttons.

interface ICustomMenuItem {
  label: string;
  command?: () => void;
}

const customMenuRef = vue.useTemplateRef<HTMLElement>('customMenuRef');
const customMenu = vue.ref<{ x: number; y: number; items: ICustomMenuItem[]; instance: number } | null>(null);

const flattenedItems = (items: IContextMenuItem[], prefix: string = ''): ICustomMenuItem[] => {
  return items.flatMap((item: IContextMenuItem): ICustomMenuItem[] => {
    if ('separator' in item) {
      return [{ label: '' }];
    }

    const label = `${prefix}${item.label}${item.checked ? ' ✓' : ''}`;

    return item.items ? flattenedItems(item.items, `${label} › `) : [{ label, command: item.command }];
  });
};

const onContextMenu = async (event: IPlotContextMenuEvent, instance: number): Promise<void> => {
  customMenu.value = { x: event.clientX, y: event.clientY, items: flattenedItems(event.items), instance };

  window.addEventListener('blur', hideCustomMenu);
  window.addEventListener('pointerdown', onWindowPointerDown, true);

  await vue.nextTick();

  customMenuRef.value?.focus();
};

const hideCustomMenu = (): void => {
  if (!customMenu.value) {
    return;
  }

  const instance = customMenu.value.instance;

  customMenu.value = null;

  window.removeEventListener('blur', hideCustomMenu);
  window.removeEventListener('pointerdown', onWindowPointerDown, true);

  plotRefs[instance]?.contextMenuHidden();
};

const onCustomMenuItemClick = (command: () => void): void => {
  hideCustomMenu();

  command();
};

const onWindowPointerDown = (event: PointerEvent): void => {
  if (!(event.target instanceof Node) || !customMenuRef.value?.contains(event.target)) {
    hideCustomMenu();
  }
};
</script>

<style scoped>
  /**
   * Our plots on the left and our sidebar (i.e. our options and status) on the right, or our sidebar below our plots if
   * our window is narrow.
   */

  .demo {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20rem;
    height: 100%;
  }

  .demo-main {
    display: grid;
    gap: 0.5rem;
    min-height: 0;
    padding: 1rem;
  }

  .demo-plot {
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--demo-border);
  }

  .demo-sidebar {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    overflow-y: auto;
    padding: 1rem;
    border-left: 1px solid var(--demo-border);
    font-size: 0.875rem;
  }

  @media (width <= 800px) {
    .demo {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(20rem, 1fr) auto;
      height: auto;
      min-height: 100%;
    }

    .demo-sidebar {
      border-top: 1px solid var(--demo-border);
      border-left: none;
    }
  }

  .demo-sidebar h1 {
    margin: 0;
    font-size: 1.25rem;
  }

  .demo-sidebar section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .demo-sidebar h2 {
    margin: 0;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--demo-border);
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.7;
  }

  /**
   * A field, i.e. a label on the left and its control on the right, and a checkbox with its label.
   */

  .demo-field {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr);
    gap: 0.5rem;
    align-items: center;
  }

  .demo-check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .demo-sidebar select,
  .demo-sidebar button {
    padding: 0.125rem 0.25rem;
    font: inherit;
  }

  /**
   * Our status, i.e. a term on the left and its value on the right.
   */

  .demo-status {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr);
    gap: 0.375rem 0.5rem;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .demo-status dt {
    opacity: 0.8;
  }

  .demo-status dd {
    overflow: hidden;
    margin: 0;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .demo-custom-menu {
    position: fixed;
    z-index: 1000;
    margin: 0;
    padding: 0.25rem;
    border: 2px dashed #e15759;
    background-color: var(--demo-background);
    list-style: none;
  }

  .demo-custom-menu button {
    width: 100%;
    padding: 0.25rem 0.5rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .demo-custom-menu button:hover,
  .demo-custom-menu button:focus-visible {
    background-color: var(--demo-border);
  }

  .demo-custom-menu hr {
    margin: 0.25rem 0;
    border: none;
    border-top: 1px solid var(--demo-border);
  }
</style>
