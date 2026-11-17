<template>
  <div class="demo">
    <header class="demo-header">
      <h1>OpenCOR Plot</h1>
      <label>
        Theme:
        <select v-model="theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
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
        <span v-if="csvExportStatus">{{ csvExportStatus }}</span>
        <span>Drawn using: {{ ACTIVE_RENDERER_NAMES[plotRef?.activeRenderer ?? 'none'] }}</span>
      </span>
    </header>
    <main class="demo-main">
      <div class="demo-plot">
        <OpenCORPlot ref="plotRef"
          :data="data"
          :theme="theme"
          :renderer="renderer"
          :showLegend="showLegend"
          :customContextMenu="customContextMenu"
          @contextMenu="onContextMenu"
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
  type PlotActiveRenderer,
  type PlotRenderer,
  type PlotTheme,
  type IContextMenuItem,
  type IPlotContextMenuEvent,
  type IPlotCsvExportEvent,
  type IPlotData
} from '../index';

// Some data to plot, i.e. a few traces with 1,001 points each.

const NB_OF_POINTS = 1001;
const X_MAX = 10;
const ONE_OVER_NB_OF_POINTS_MINUS_ONE = 1 / (NB_OF_POINTS - 1);

const x = Float64Array.from(
  { length: NB_OF_POINTS },
  (_value: number, i: number) => i * X_MAX * ONE_OVER_NB_OF_POINTS_MINUS_ONE
);
const trace = (name: string, color: string, f: (x: number) => number) => {
  return { name, xValue: 'x', x, yValue: name, y: x.map(f), color };
};

const data: IPlotData = {
  xAxisTitle: 'Time (<i>s</i>)',
  yAxisTitle: 'Signal',
  traces: [
    trace('sin(x)', '#4e79a7', Math.sin),
    trace('cos(x)', '#f28e2b', Math.cos),
    trace('e<sup>−x/3</sup> sin(3x)', '#59a14f', (x: number) => Math.exp(-x / 3) * Math.sin(3 * x))
  ]
};

// Our options.

const theme = vue.ref<PlotTheme>('system');
const renderer = vue.ref<PlotRenderer>('auto');
const showLegend = vue.ref<boolean>(true);
const customContextMenu = vue.ref<boolean>(false);

// The renderer that our plot actually uses to draw its traces.

const ACTIVE_RENDERER_NAMES: Record<PlotActiveRenderer, string> = {
  canvas: 'Canvas 2D',
  webgl: 'WebGL',
  none: 'nothing (WebGL is not available)'
};

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

const plotRef = vue.useTemplateRef<InstanceType<typeof OpenCORPlot>>('plotRef');
const customMenuRef = vue.useTemplateRef<HTMLElement>('customMenuRef');
const customMenu = vue.ref<{ x: number; y: number; items: ICustomMenuItem[] } | null>(null);

const flattenedItems = (items: IContextMenuItem[], prefix: string = ''): ICustomMenuItem[] => {
  return items.flatMap((item: IContextMenuItem): ICustomMenuItem[] => {
    if ('separator' in item) {
      return [{ label: '' }];
    }

    const label = `${prefix}${item.label}${item.checked ? ' ✓' : ''}`;

    return item.items ? flattenedItems(item.items, `${label} › `) : [{ label, command: item.command }];
  });
};

const onContextMenu = async (event: IPlotContextMenuEvent): Promise<void> => {
  customMenu.value = { x: event.clientX, y: event.clientY, items: flattenedItems(event.items) };

  window.addEventListener('blur', hideCustomMenu);
  window.addEventListener('pointerdown', onWindowPointerDown, true);

  await vue.nextTick();

  customMenuRef.value?.focus();
};

const hideCustomMenu = (): void => {
  if (!customMenu.value) {
    return;
  }

  customMenu.value = null;

  window.removeEventListener('blur', hideCustomMenu);
  window.removeEventListener('pointerdown', onWindowPointerDown, true);

  plotRef.value?.contextMenuHidden();
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
  }

  .demo-main {
    flex-grow: 1;
    min-height: 0;
    padding: 1rem;
  }

  .demo-plot {
    height: 100%;
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
