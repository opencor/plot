<template>
  <div class="demo">
    <header class="demo-header">
      <h1>OpenCOR Plot</h1>
      <label>
        Data:
        <select v-model="kind">
          <option v-for="(name, value) in DATA_KINDS" :key="value" :value="value">{{ name }}</option>
        </select>
      </label>
      <label>
        Traces:
        <select v-model.number="nbOfTraces">
          <option v-for="value in NBS_OF_TRACES" :key="value" :value="value"
            :disabled="tooManyPoints(nbOfInstances, value, nbOfPoints)"
          >
            {{ formatNumber(value) }}
          </option>
        </select>
      </label>
      <label>
        Points per trace:
        <select v-model.number="nbOfPoints">
          <option v-for="value in NBS_OF_POINTS" :key="value" :value="value"
            :disabled="tooManyPoints(nbOfInstances, nbOfTraces, value)"
          >
            {{ formatNumber(value) }}
          </option>
        </select>
      </label>
      <label>
        Instances:
        <select v-model.number="nbOfInstances">
          <option v-for="value in NBS_OF_INSTANCES" :key="value" :value="value"
            :disabled="tooManyPoints(value, nbOfTraces, nbOfPoints)"
          >
            {{ formatNumber(value) }}
          </option>
        </select>
      </label>
      <label>
        Theme:
        <select v-model="theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="mixed">Mixed</option>
        </select>
      </label>
      <label>
        Renderer:
        <select v-model="renderer">
          <option value="auto">Auto</option>
          <option value="canvas">Canvas 2D</option>
          <option value="webgl">WebGL</option>
        </select>
      </label>
      <label>
        <input v-model="showLegend" type="checkbox" />
        Legend
      </label>
      <label>
        <input v-model="customContextMenu" type="checkbox" />
        Custom context menu
      </label>
      <span class="demo-status">
        <span v-if="dataStatus">{{ dataStatus }}</span>
        <span v-if="csvExportStatus">{{ csvExportStatus }}</span>
        <span>{{ fps }} FPS</span>
        <span>Drawn using: {{ activeRenderers }}</span>
        <span>Drawn points: {{ drawnPoints }}</span>
      </span>
    </header>
    <main class="demo-main" :style="gridStyle">
      <div v-for="(data, index) in datasets" :key="index" class="demo-plot">
        <OpenCORPlot :ref="(plot) => setPlotRef(plot, index)"
          :data="data"
          :theme="instanceTheme(index)"
          :renderer="renderer"
          :showLegend="showLegend"
          :customContextMenu="customContextMenu"
          @contextMenu="(event) => onContextMenu(event, index)"
          @csvExport="onCsvExport"
        />
      </div>
    </main>
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
  type PlotActiveRenderer,
  type PlotRenderer,
  type PlotTheme
} from '../index';
import { DATA_KINDS, type DataKind, plotData } from './data';

type PlotInstance = InstanceType<typeof OpenCORPlot>;

// Our options.

const NBS_OF_TRACES = [1, 3, 10, 30, 100];
const NBS_OF_POINTS = [10, 100, 1000, 10000, 100000, 1000000, 10000000];
const NBS_OF_INSTANCES = [1, 2, 4, 9, 16, 25, 36, 49];

const kind = vue.ref<DataKind>('smooth');
const nbOfTraces = vue.ref<number>(3);
const nbOfPoints = vue.ref<number>(1000);
const nbOfInstances = vue.ref<number>(1);
const theme = vue.ref<PlotTheme | 'mixed'>('system');
const renderer = vue.ref<PlotRenderer>('auto');
const showLegend = vue.ref<boolean>(true);
const customContextMenu = vue.ref<boolean>(false);

const formatNumber = (value: number): string => {
  return value.toLocaleString('en');
};

const percentage = (ratio: number): string => {
  return ratio.toLocaleString('en', { style: 'percent', maximumSignificantDigits: 2 });
};

const instanceTheme = (index: number): PlotTheme => {
  // Return the theme of the given instance, alternating between light and dark if our theme is mixed.

  if (theme.value === 'mixed') {
    return index % 2 ? 'dark' : 'light';
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

  datasets.value = [];
  dataStatus.value = `Generating ${formatNumber(totalNbOfPoints)} points...`;

  await nextPaint();

  if (generation !== dataGeneration) {
    return;
  }

  const startTime = performance.now();

  datasets.value = Array.from({ length: nbOfInstances.value }, (_value, instance) =>
    plotData(kind.value, nbOfTraces.value, nbOfPoints.value, instance)
  );
  dataStatus.value = `${formatNumber(totalNbOfPoints)} points (generated in ${Math.round(performance.now() - startTime)} ms)`;
};

vue.watch([kind, nbOfTraces, nbOfPoints, nbOfInstances], generateData, { immediate: true });

// Our instances, laid out in a grid that is as square as possible.

const plotRefs: (PlotInstance | null)[] = [];

const setPlotRef = (plot: unknown, index: number): void => {
  plotRefs[index] = plot as PlotInstance | null;
};

const gridStyle = vue.computed(() => {
  const nbOfColumns = Math.ceil(Math.sqrt(datasets.value.length));
  const nbOfRows = Math.ceil(datasets.value.length / Math.max(1, nbOfColumns));

  return {
    gridTemplateColumns: `repeat(${nbOfColumns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${nbOfRows}, minmax(0, 1fr))`
  };
});

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

  drawnPoints.value = `${formatNumber(nbOfDrawnPoints)} of ${formatNumber(nbOfPoints)}${nbOfPoints ? ` (${percentage(nbOfDrawnPoints / nbOfPoints)})` : ''}`;

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
  cancelAnimationFrame(fpsFrameId);
});

// CSV export progress.

const csvExportStatus = vue.ref<string>('');

const onCsvExport = (event: IPlotCsvExportEvent): void => {
  if (event.type === 'started') {
    csvExportStatus.value = 'Exporting to CSV...';
  } else if (event.type === 'progress') {
    csvExportStatus.value = `Exporting to CSV... ${event.percent}%`;
  } else {
    csvExportStatus.value = event.success ? 'Exported to CSV.' : 'Failed to export to CSV.';

    setTimeout(() => {
      csvExportStatus.value = '';
    }, 2000);
  }
};

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
  .demo {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .demo-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--demo-border);
  }

  .demo-header > * {
    white-space: nowrap;
  }

  .demo-header h1 {
    margin: 0;
    font-size: 1.25rem;
  }

  .demo-header label {
    display: flex;
    gap: 0.375rem;
    align-items: center;
  }

  .demo-header select {
    padding: 0.125rem 0.25rem;
    font: inherit;
  }

  .demo-status {
    display: flex;
    gap: 1.5rem;
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .demo-main {
    display: grid;
    flex-grow: 1;
    gap: 0.5rem;
    min-height: 0;
    padding: 1rem;
  }

  .demo-plot {
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--demo-border);
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
