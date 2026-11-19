<template>
  <div class="demo">
    <main class="demo-main" :style="gridStyle">
      <div v-for="(data, index) in datasets" :key="index" class="demo-plot">
        <OpenCORPlot :ref="(plot) => setPlotRef(plot, index)"
          :data="data"
          :theme="instanceTheme(index)"
          :renderer="renderer"
          :levelOfDetail="levelOfDetail"
          :live="liveRunning"
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
        Note #1: our status has a fixed number of rows, each of which is a single line (with an ellipsis and a tooltip
                 if its value is too long), so that it never makes the rest of our sidebar move.
        Note #2: a value is highlighted while it is in progress (e.g., "Running..."), and briefly once it has changed
                 (except for our frame rate, which changes all the time). For the latter, the span of a value is keyed
                 by its contents, so that it gets recreated (and its highlight animation replayed) whenever it changes.
        -->
        <dl class="demo-status">
          <template v-for="row in statusRows" :key="row.term">
            <dt>{{ row.term }}</dt>
            <dd>
              <span :key="row.value" class="demo-status-value"
                :class="{
                  'demo-status-changed': statusMounted && row.term !== 'Frame rate',
                  'demo-status-in-progress': row.value.includes('...')
                }"
                :title="row.value"
              >
                {{ row.value || '—' }}
              </span>
            </dd>
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
  type IPlotMemoryUsage,
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

const formatBytes = (bytes: number): string => {
  // Return the given number of bytes in B, KB, MB, or GB (with one decimal), whichever is the most appropriate.

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    ++unit;
  }

  return unit ? `${value.toFixed(1)} ${units[unit]}` : `${value} B`;
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
const dataMemoryStatus = vue.ref<string>(''); // Memory used by our data.
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
  dataMemoryStatus.value = '';
  firstDrawStatus.value = '';

  await nextPaint();

  if (generation !== dataGeneration) {
    return;
  }

  const startTime = performance.now();

  generatedDatasets = Array.from({ length: nbOfInstances.value }, (_value, instance) =>
    plotData(kind.value, nbOfTraces.value, nbOfPoints.value, instance)
  );
  dataStatus.value = `${formatNumber(totalNbOfPoints)} points in ${formatNumber(Math.round(performance.now() - startTime))} ms`;

  // Determine how much memory our data uses, making sure that we count only once the X values that our traces share.

  const buffers = new Set<ArrayBufferLike>();

  for (const data of generatedDatasets) {
    for (const trace of data.traces) {
      buffers.add(trace.x.buffer);
      buffers.add(trace.y.buffer);
    }
  }

  dataMemoryStatus.value = formatBytes([...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0));

  showData();
};

// Live updating, i.e. our data gets plotted as if it was being generated (e.g., by a simulation), at the given number
// of points per second (per trace), starting again after a short pause once all of it has been plotted.
// Note #1: the X and Y values of a trace are views of the same buffers as before (i.e. those of our generated data),
//          only longer, i.e. they are a continuation of their previous values (see traceValues.ts).
// Note #2: our X range is either the range of our data so far (i.e. it grows) or the range of all of our data (i.e. it
//          is fixed), like a simulation that is plotted for its whole duration.
// Note #3: our instances are only told that our data is live while a run is going (i.e. while some of our data has yet
//          to be plotted), so that the last point of their traces only gets marked during a run, like a consumer would
//          do while a simulation is running.

const LIVE_PAUSE = 1000; // Pause (in milliseconds) before starting again, once all of our data has been plotted.

let liveFrameId = 0;
let liveNbOfPoints = 0; // Number of points per trace that we have plotted so far.
let liveTotalNbOfPoints = 0; // Number of points per trace that we will have plotted in the end.
const liveStatus = vue.ref<string>('');
const liveRunning = vue.ref<boolean>(false); // Whether a run is going, i.e. some of our data is yet to be plotted.

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
  liveRunning.value = false;
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

    liveRunning.value = newNbOfPoints < totalNbOfPoints;

    liveFrameId = requestAnimationFrame(onFrame);
  };

  liveFrameId = requestAnimationFrame(onFrame);
};

// Time to first draw, i.e. the time it takes from giving all of our data to our instances to them having drawn it (and
// the browser having painted it), which includes the time it takes to (re)create our instances, to process our data
// (see plotData() in PlotWidget.vue), and to draw it (e.g., uploading it to the GPU and building its level of detail).

const firstDrawStatus = vue.ref<string>(''); // Time to first draw of our data, if it was not plotted live.
let showGeneration = 0; // Number of times that we showed our data, so that we can discard outdated time measurements.

const showData = (): void => {
  // Show our generated data, either live or all at once, in which case we measure the time to first draw.

  const generation = ++showGeneration;

  firstDrawStatus.value = '';

  if (live.value) {
    startLive();
  } else {
    stopLive();

    const startTime = performance.now();

    datasets.value = generatedDatasets;

    void nextPaint().then(() => {
      if (generation === showGeneration) {
        firstDrawStatus.value = `${formatNumber(Math.round(performance.now() - startTime))} ms`;
      }
    });
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

  const scale = benchmarkResizeScale.value;

  return {
    gridTemplateColumns: `repeat(${nbOfColumns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${nbOfRows}, minmax(0, 1fr))`,
    width: scale !== 1 ? `${100 * scale}%` : undefined,
    height: scale !== 1 ? `${100 * scale}%` : undefined
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
const lodMemoryStatus = vue.ref<string>(''); // Memory used by the levels of detail of our instances.
const logMemoryStatus = vue.ref<string>(''); // Memory used by the logarithm of the values of our instances.
const gpuMemoryStatus = vue.ref<string>(''); // Memory used by our instances on the GPU.
let fpsFrameId = 0;

const updateDrawingStatus = (): void => {
  const counts = new Map<PlotActiveRenderer, number>();
  let nbOfPoints = 0;
  let nbOfDrawnPoints = 0;
  const memoryUsage: IPlotMemoryUsage = { levelOfDetail: 0, logValues: 0, gpu: 0 };

  for (const plot of plotRefs.slice(0, datasets.value.length)) {
    if (plot) {
      const pointCounts = plot.pointCounts();
      const plotMemoryUsage = plot.memoryUsage();

      memoryUsage.levelOfDetail += plotMemoryUsage.levelOfDetail;
      memoryUsage.logValues += plotMemoryUsage.logValues;
      memoryUsage.gpu += plotMemoryUsage.gpu;

      counts.set(plot.activeRenderer, (counts.get(plot.activeRenderer) ?? 0) + 1);

      nbOfPoints += pointCounts.nbOfPoints;
      nbOfDrawnPoints += pointCounts.nbOfDrawnPoints;
    }
  }

  if (liveFrameId) {
    liveStatus.value = `${formatNumber(liveNbOfPoints)} of ${formatNumber(liveTotalNbOfPoints)} per trace`;
  }

  plottedPoints.value = formatNumber(nbOfPoints);
  lodMemoryStatus.value = formatBytes(memoryUsage.levelOfDetail);
  logMemoryStatus.value = formatBytes(memoryUsage.logValues);
  gpuMemoryStatus.value = formatBytes(memoryUsage.gpu);
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

// Benchmark, i.e. we redraw all of our instances every frame for a few seconds, and then report our frame rate and how
// long it takes our instances to redraw themselves. We do this for different interactions, one after the other:
//  - zoom: we zoom our instances in (up to BENCHMARK_MAX_ZOOM times, along both axes) and then out again, over and
//    over, so that they get redrawn both when most and when few of their points are visible;
//  - pan: we zoom our instances in along their X axis only (BENCHMARK_PAN_ZOOMS times, so that their Y axis keeps its
//    full range and they don't end up showing an empty area), and we then pan them along their X axis, towards one end
//    of their data and then towards the other, over and over. Without any zoom, all of our points are visible, so we
//    pan our instances by up to half of their X range either way (i.e. so that up to half of their plotting area ends
//    up being empty); and
//  - live: we plot our data as if it was being generated (see Live updating above), from no points to all of them in
//    BENCHMARK_LIVE_FRAMES frames, over and over, with a fixed X range (like a simulation that is plotted for its whole
//    duration). This means that every frame, our instances get a few more points (i.e. a continuation of their
//    previous ones, see traceValues.ts), which they need to process and draw; and
//  - resize: we shrink our instances (i.e. our grid of instances) to BENCHMARK_MIN_RESIZE_SCALE of their width and
//    height, and then grow them back, in BENCHMARK_RESIZE_FRAMES frames, over and over (like when resizing a window).
//    This means that every frame, our instances get laid out and drawn again.
// Note #1: our frame rate is capped by the refresh rate of the display (e.g., 60 FPS), so the time it takes our
//          instances to redraw themselves is what tells us how much headroom we have.
// Note #2: our instances redraw themselves in their requestAnimationFrame() callbacks, which they request when they
//          get zoomed, panned, or updated (or when they get resized, once the browser has laid out our frame). So,
//          every frame, we zoom, pan, or update them from a requestAnimationFrame() callback (onFrameEnd()) that we
//          request after that (so that it gets called after theirs in the next frame) and that is preceded by another
//          one (onFrameStart()) that we request before that (so that it gets called before theirs in the next frame).
//          The redraw time of our instances is then the time between the start of onFrameStart() and the end of the
//          frame, i.e. once the browser has rendered it, which is when the message that onFrameEnd() posts gets
//          handled. This includes everything that happens during the frame: our instances redrawing themselves,
//          processing their new data (which they do once onFrameEnd() has returned), and the browser rendering the
//          frame.
// Note #3: WebGL draws asynchronously, so the GPU time of a frame is not (fully) included in the redraw time of our
//          instances (but it limits our frame rate if our frame rate is not capped).
// Note #4: we zoom our instances by sending wheel events to them (i.e. to the element of uPlot that handles them, or to
//          their X axis dragger to only zoom along their X axis), we pan them by sending them arrow key presses (i.e.
//          to their plotting area), and we reset their zoom between interactions by sending them a "0" key press.
// Note #5: an arrow key press pans an axis by KEYBOARD_PAN_FRACTION of its length (see PlotWidget.vue), so with a zoom
//          of Z, our instances get from the middle of their data to one of its ends in 5 * (Z - 1) frames, and from
//          one end to the other in 10 * (Z - 1) frames. Without any zoom, they get panned by half of their X range in
//          5 frames.

const BENCHMARK_DURATION = 5000; // Duration (in milliseconds) of each of our interactions.
const BENCHMARK_MAX_ZOOM = 100; // Maximum zoom of our zoom interaction.
const BENCHMARK_PAN_ZOOMS = [1, 10, 100]; // Zooms at which we pan our instances.
const BENCHMARK_WHEEL_DELTA = 20; // Biggest wheel delta that our plot accounts for, i.e. a zoom factor of e^0.1.
const BENCHMARK_RESET_DELAY = 500; // Delay (in milliseconds) for our zoom to be reset (since it is animated).
const BENCHMARK_LIVE_FRAMES = 300; // Number of frames in which we plot all of our data live.
const BENCHMARK_MIN_RESIZE_SCALE = 0.6; // Smallest scale of our grid of instances, when we resize them.
const BENCHMARK_RESIZE_FRAMES = 120; // Number of frames in which we shrink our instances and grow them back.
const KEYBOARD_PAN_FRACTION = 0.1; // See Note #5 above.

const zoomSteps = (zoom: number): number => {
  // Return the number of wheel events that are needed to zoom in by the given zoom.

  return Math.round((200 / BENCHMARK_WHEEL_DELTA) * Math.log(zoom));
};

interface IBenchmarkResult {
  fps: string;
  redraw: string;
}

const benchmarking = vue.ref<boolean>(false); // Whether we are running our benchmark.
const benchmarkInteraction = vue.ref<string>(''); // Name of the interaction that we are running, if any.
const benchmarkResizeScale = vue.ref<number>(1); // Scale of our grid of instances (see our resize interaction).
const benchmarkResults = vue.ref<Record<string, IBenchmarkResult>>({}); // Results of our interactions, by name.
let benchmarkRun = 0; // Number of the current run of our benchmark, so that a stopped run can tell that it was stopped.
let benchmarkFrameStartId = 0; // Id of our next onFrameStart() callback.
let benchmarkFrameEndId = 0; // Id of our next onFrameEnd() callback.

const stopBenchmark = (): void => {
  // Stop our benchmark, if it is running.

  cancelAnimationFrame(benchmarkFrameStartId);
  cancelAnimationFrame(benchmarkFrameEndId);

  ++benchmarkRun;

  benchmarkFrameStartId = 0;
  benchmarkFrameEndId = 0;
  benchmarking.value = false;
  benchmarkInteraction.value = '';
  benchmarkResizeScale.value = 1;
};

const percentile = (values: number[], fraction: number): number => {
  // Return the given percentile (as a fraction) of the given values.

  const sortedValues = [...values].sort((value1, value2) => value1 - value2);

  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length))] ?? 0;
};

const benchmarkPlotAreas = (): HTMLElement[] => {
  return [...document.querySelectorAll<HTMLElement>('.demo-plot .plot-area')];
};

const sendWheelEvent = (element: HTMLElement, zoomIn: boolean): void => {
  // Send a wheel event to the middle of the given element, to zoom in or out.

  const rect = element.getBoundingClientRect();

  element.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: zoomIn ? -BENCHMARK_WHEEL_DELTA : BENCHMARK_WHEEL_DELTA,
      clientX: rect.x + 0.5 * rect.width,
      clientY: rect.y + 0.5 * rect.height,
      bubbles: true,
      cancelable: true
    })
  );
};

const sendKeyPress = (key: string): void => {
  // Send the given key press to all of our instances.

  for (const plotArea of benchmarkPlotAreas()) {
    plotArea.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
};

const runInteraction = (interact: (frame: number) => void): Promise<IBenchmarkResult | undefined> => {
  // Run the given interaction every frame for BENCHMARK_DURATION, and return our frame rate and the redraw time of our
  // instances, or nothing if our benchmark got stopped (see Note #2 above).

  const run = benchmarkRun;

  return new Promise((resolve) => {
    const redrawDurations: number[] = [];
    const frameEndChannel = new MessageChannel();
    let startTime = -1;
    let frameStartTime = 0;
    let nbOfFrames = 0;
    let frame = 0;

    frameEndChannel.port1.onmessage = (): void => {
      // Keep track of how long our frame took (but not for our first frame, since our instances haven't had anything
      // to redraw yet).

      if (nbOfFrames > 1) {
        redrawDurations.push(performance.now() - frameStartTime);
      }
    };

    const onFrameStart = (time: number): void => {
      // Start a new frame, unless we are done.

      if (run !== benchmarkRun) {
        frameEndChannel.port1.close();
        resolve(undefined);

        return;
      }

      if (startTime < 0) {
        startTime = time;
      } else if (time - startTime >= BENCHMARK_DURATION) {
        cancelAnimationFrame(benchmarkFrameEndId);
        frameEndChannel.port1.close();

        const averageRedrawDuration =
          redrawDurations.reduce((sum, value) => sum + value, 0) / Math.max(1, redrawDurations.length);

        resolve({
          fps: `${Math.round((1000 * nbOfFrames) / (time - startTime))} FPS`,
          redraw: `${averageRedrawDuration.toFixed(1)} ms (95%: ${percentile(redrawDurations, 0.95).toFixed(1)} ms)`
        });

        return;
      }

      ++nbOfFrames;

      frameStartTime = performance.now();
      benchmarkFrameStartId = requestAnimationFrame(onFrameStart);
    };

    const onFrameEnd = (): void => {
      // Interact with our instances, and get to know when our frame has been rendered.

      interact(frame++);

      frameEndChannel.port2.postMessage(null);

      benchmarkFrameEndId = requestAnimationFrame(onFrameEnd);
    };

    benchmarkFrameStartId = requestAnimationFrame(onFrameStart);
    benchmarkFrameEndId = requestAnimationFrame(onFrameEnd);
  });
};

const nextFrame = (): Promise<number> => {
  return new Promise((resolve) => {
    benchmarkFrameStartId = requestAnimationFrame(resolve);
  });
};

const delay = (duration: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
};

const runBenchmark = async (): Promise<void> => {
  // Run our benchmark (see above).

  stopBenchmark();

  const run = benchmarkRun;
  const isStopped = (): boolean => run !== benchmarkRun;
  const record = (name: string, result: IBenchmarkResult | undefined): boolean => {
    // Record the result of the given interaction, reset the zoom of our instances, and return whether we can carry on.

    sendKeyPress('0');

    benchmarkInteraction.value = '';

    if (!result) {
      return false;
    }

    benchmarkResults.value = { ...benchmarkResults.value, [name]: result };

    return true;
  };

  benchmarking.value = true;
  benchmarkResults.value = {};

  // Zoom our instances in and out, along both axes.

  benchmarkInteraction.value = 'zoom';

  const maxZoomSteps = zoomSteps(BENCHMARK_MAX_ZOOM);
  const overs = [...document.querySelectorAll<HTMLElement>('.demo-plot .u-over')];

  if (
    !record(
      'zoom',
      await runInteraction((frame) => {
        const zoomIn = Math.floor(frame / maxZoomSteps) % 2 === 0;

        for (const over of overs) {
          sendWheelEvent(over, zoomIn);
        }
      })
    )
  ) {
    return;
  }

  // Pan our instances, at different zooms.

  for (const zoom of BENCHMARK_PAN_ZOOMS) {
    benchmarkInteraction.value = `pan${zoom}`;

    await delay(BENCHMARK_RESET_DELAY);

    // Zoom our instances in along their X axis only (i.e. using their X axis dragger), and wait for them to be done
    // animating.

    const xAxisDraggers = [...document.querySelectorAll<HTMLElement>('.demo-plot .dragger')].filter(
      (dragger) => dragger.style.cursor === 'ew-resize'
    );

    for (let i = zoomSteps(zoom); i > 0; --i) {
      for (const xAxisDragger of xAxisDraggers) {
        sendWheelEvent(xAxisDragger, true);
      }

      await nextFrame();

      if (isStopped()) {
        return;
      }
    }

    await delay(BENCHMARK_RESET_DELAY);

    if (isStopped()) {
      return;
    }

    // Pan our instances from the middle of their data to one of its ends, then to the other, and so on (see Note #5
    // above).

    const halfSweep = Math.max(5 * (zoom - 1), 5);

    if (
      !record(
        `pan${zoom}`,
        await runInteraction((frame) => {
          const sweep = Math.floor((frame + halfSweep) / (2 * halfSweep));

          sendKeyPress(sweep % 2 === 0 ? 'ArrowRight' : 'ArrowLeft');
        })
      )
    ) {
      return;
    }
  }

  // Plot our data live, with a fixed X range, stopping our own live updating, if any, while we do so, and then showing
  // our data as it was before (i.e. all at once or live).

  benchmarkInteraction.value = 'live';

  await delay(BENCHMARK_RESET_DELAY);

  if (isStopped()) {
    return;
  }

  stopLive();

  const totalNbOfPoints = nbOfPoints.value;
  const nbOfPointsPerFrame = Math.max(1, Math.ceil(totalNbOfPoints / BENCHMARK_LIVE_FRAMES));
  const xAxisRanges = generatedDatasets.map((data) => xAxisRange(data));
  const liveResult = await runInteraction((frame) => {
    const newNbOfPoints = Math.min(totalNbOfPoints, (frame % (BENCHMARK_LIVE_FRAMES + 1)) * nbOfPointsPerFrame);

    datasets.value = liveDatasets(newNbOfPoints, xAxisRanges);
    liveRunning.value = newNbOfPoints < totalNbOfPoints;
  });

  if (!isStopped()) {
    showData();
  }

  if (!record('live', liveResult)) {
    return;
  }

  // Resize our instances, i.e. shrink them and grow them back, over and over, and then make them their normal size
  // again.

  benchmarkInteraction.value = 'resize';

  await delay(BENCHMARK_RESET_DELAY);

  if (isStopped()) {
    return;
  }

  const halfResize = 0.5 * BENCHMARK_RESIZE_FRAMES;
  const resizeResult = await runInteraction((frame) => {
    const progress = 1 - Math.abs(((frame % BENCHMARK_RESIZE_FRAMES) - halfResize) / halfResize);

    benchmarkResizeScale.value = 1 - (1 - BENCHMARK_MIN_RESIZE_SCALE) * progress;
  });

  benchmarkResizeScale.value = 1;

  if (!record('resize', resizeResult)) {
    return;
  }

  benchmarking.value = false;
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

const benchmarkRows = vue.computed(() => {
  // The results of our benchmark (see above), i.e. our frame rate and redraw time for each of our interactions.

  const interactions: [name: string, label: string][] = [
    ['zoom', 'Zoom'],
    ...BENCHMARK_PAN_ZOOMS.map((zoom): [string, string] => [`pan${zoom}`, `Pan (${zoom}×)`]),
    ['live', 'Live'],
    ['resize', 'Resize']
  ];

  return interactions.flatMap(([name, label]) => {
    const result = benchmarkResults.value[name];

    return [
      { term: `${label} benchmark`, value: result?.fps ?? (benchmarkInteraction.value === name ? 'Running...' : '') },
      { term: `${label} redraw`, value: result?.redraw ?? '' }
    ];
  });
});

const statusMounted = vue.ref<boolean>(false); // Whether our status is mounted (so it isn't highlighted then).

vue.onMounted(() => {
  void vue.nextTick().then(() => {
    statusMounted.value = true;
  });
});

const statusRows = vue.computed(() => [
  { term: 'Frame rate', value: `${fps.value} FPS` },
  { term: 'Drawn using', value: activeRenderers.value },
  { term: 'Points', value: plottedPoints.value },
  { term: 'Drawn points', value: drawnPoints.value },
  { term: 'Data', value: dataStatus.value },
  { term: 'First draw', value: firstDrawStatus.value },
  { term: 'Data memory', value: dataMemoryStatus.value },
  { term: 'LOD memory', value: lodMemoryStatus.value },
  { term: 'Log memory', value: logMemoryStatus.value },
  { term: 'GPU memory', value: gpuMemoryStatus.value },
  { term: 'Live', value: liveStatus.value },
  ...benchmarkRows.value,
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
    min-width: 0;
    margin: 0;
  }

  .demo-status-value {
    display: block;
    overflow: hidden;
    margin: 0 -0.25rem;
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /**
   * Note: a changed value keeps our highlight colour for a moment and then fades to no background, while a value in
   *       progress keeps our highlight colour (see our template).
   */

  .demo-status-changed {
    animation: demo-status-changed 2s ease-out;
  }

  .demo-status-in-progress {
    background-color: var(--demo-highlight);
    animation: none;
  }

  @keyframes demo-status-changed {
    0%,
    25% {
      background-color: var(--demo-highlight);
    }

    100% {
      background-color: transparent;
    }
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
