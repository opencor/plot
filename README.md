# OpenCOR Plot

`@opencor/plot` is a [Vue 3](https://vuejs.org/) component for plotting data. It is used by [OpenCOR](https://opencor.ws/), but it can be used by any Vue 3 application.

Key characteristics:
- Built as a [Vue 3](https://vuejs.org/) component using the [Composition API](https://vuejs.org/guide/extras/composition-api-faq).
- Uses [uPlot](https://github.com/leeoniya/uPlot) under the hood with [WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API) for rendering traces (and a Canvas 2D fallback when WebGL is not available or not precise enough, e.g. when zoomed in a lot).
- It does not rely on any UI framework (e.g., [PrimeVue](https://www.primefaces.org/primevue/)) or CSS framework (e.g., [Tailwind CSS](https://tailwindcss.com/)).

## Installation

```bash
bun add @opencor/plot  # Or npm install @opencor/plot, etc.
```

[Vue 3](https://vuejs.org/) is a peer dependency. [uPlot](https://github.com/leeoniya/uPlot) is our only other runtime dependency and gets installed along with `@opencor/plot`.

## Usage

```vue
<template>
  <div style="height: 640px">
    <OpenCORPlot :data="data" />
  </div>
</template>

<script setup lang="ts">
import OpenCORPlot, { type IPlotData } from '@opencor/plot';
import '@opencor/plot/style.css';

const x = Float64Array.from({ length: 1000 }, (_, i) => i / 100);

const data: IPlotData = {
  xAxisTitle: 'Time (s)',
  yAxisTitle: 'Voltage (mV)',
  traces: [
    {
      name: 'V',
      xValue: 'time',
      x,
      yValue: 'membrane.V',
      y: x.map((t) => Math.sin(t)),
      color: '#2563eb'
    }
  ]
};
</script>
```

The component fills its container, so the container must have a height. `@opencor/plot/style.css` contains all the CSS that is needed, including uPlot's.

### Data

`IPlotData`:

| Property | Type | Description |
|---|---|---|
| `traces` | `IPlotTrace[]` | The traces to plot. |
| `xAxisTitle`, `yAxisTitle` | `string` | The axis titles. |
| `xAxisRange`, `yAxisRange` | `[number, number]` | The range of an axis when the zoom is reset. By default, it fits the data. |

`IPlotTrace`:

| Property | Type | Description |
|---|---|---|
| `name` | `string` | The name of the trace, as shown in the legend, the hover tooltip, and the CSV export. |
| `x`, `y` | `Float64Array` | The X and Y values of the trace. |
| `xValue`, `yValue` | `string` | What the X and Y values are (e.g., the name of a model variable), used in the CSV export. |
| `color` | `string` | The colour of the trace. |
| `traceId` | `string` | An optional identifier that keeps the visibility of the trace when the data is updated. Otherwise, the trace is identified by its `name`, `xValue`, and `yValue`. |
| `legendRank` | `number` | The optional rank of the trace in the legend (lower ranks first, 1000 by default). |
| `runLabel` | `string` | An optional label that tells apart the X column of the trace from those of other runs in the CSV export. |

Notes:
- Titles and trace names can contain a little HTML (`b`, `br`, `code`, `em`, `i`, `strong`, `sub`, and `sup`). Anything else is removed.
- A trace can be a function of X (e.g., against time) or not (e.g., a phase plot). A point with a non-finite X or Y value (e.g., `NaN`) is a gap in its trace.
- A trace with fewer than 20 points is also drawn with markers.

### Large and live data

The component only goes through the points that are needed for a trace to look the same, so a trace with millions of points can be zoomed, panned, and hovered smoothly.

When the data is updated, the work that has already been done is reused if the new values of a trace are a *continuation* of its previous ones, i.e. a view of the same buffer, from the same offset, and at least as long. Only the new values (and the last of the previous values, which may have changed) then get processed. So, for live data (e.g., while a simulation is running), allocate a buffer for all the values, fill it as values become available, and give the component a view of the part that is filled:

```ts
const buffer = new Float64Array(nbOfPoints);

// Each time some new values have been added to the buffer:

trace.y = buffer.subarray(0, nbOfValues);
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | `IPlotData` | (required) | The data to plot. |
| `showLegend` | `boolean` | `true` | Whether to show the legend. |
| `theme` | `'system' \| 'light' \| 'dark'` | `'system'` | Whether to use light or dark mode, or whatever the system uses. |
| `margins` | `IPlotMargins` | | Margins shared with other plots, so that their plotting areas line up (see `marginsUpdated`). |
| `appendTo` | `HTMLElement \| string` | `body` | Where to append our overlays (context menu, hover tooltip, etc.). |
| `customContextMenu` | `boolean` | `false` | Whether to emit a `contextMenu` event rather than show our own context menu. |
| `renderer` | `'auto' \| 'canvas' \| 'webgl'` | `'auto'` | What to draw traces with. `'auto'` uses WebGL if it is available, and Canvas 2D otherwise. With `'webgl'`, traces are not drawn if WebGL is not available. With `'auto'` or `'webgl'`, Canvas 2D is used whenever WebGL is not precise enough for the current ranges (e.g., when zoomed in a lot). |
| `levelOfDetail` | `boolean` | `true` | Whether to only go through the points that are needed for a trace to look the same. Only meant to be disabled to see how much it helps. |

### Events

| Event | Payload | Description |
|---|---|---|
| `marginsUpdated` | `IPlotMargins` | The margins that the plot needs have changed. To line up several plots, pass the largest left and right margins of all of them to each plot's `margins` prop. |
| `csvExport` | `IPlotCsvExportEvent` | An export to CSV has `'started'`, made `'progress'` (with a `percent`), or `'finished'` (with whether it was a `success`), so that its progress can be shown. |
| `contextMenu` | `IPlotContextMenuEvent` | Only with `customContextMenu`: the context menu was requested at `clientX`/`clientY`, with the `items` that our context menu would have shown. If `usingKeyboard` is true, the custom menu should take the keyboard focus. |

### Methods

Available through a template ref:

| Method | Description |
|---|---|
| `resize()` | Resize the plot to fit its container. Not normally needed, since the component watches the size of its container. |
| `resetMargins()` | Emit `marginsUpdated` again, e.g. after the shared margins have been reset. |
| `contextMenuHidden()` | Tell the plot that a custom context menu has been hidden, so that it can get the keyboard focus back. |
| `activeRenderer` | The renderer that was last used to draw traces: `'canvas'`, `'webgl'`, or `'none'`. |
| `pointCounts()` | The number of points of the visible traces, and how many of them were last drawn. Meant for testing and benchmarking. |
| `memoryUsage()` | The memory used by the component itself, not counting the data. Meant for testing and benchmarking. |

### Interaction

Like with [Plotly](https://plotly.com/javascript/):
- **Plotting area:** drag to zoom (along one axis if the drag is mostly horizontal or vertical), use the mouse wheel to zoom around the mouse pointer, and double-click to reset the zoom.
- **Middle of an axis:** drag to pan along that axis, use the mouse wheel to zoom along it, and double-click to reset its zoom.
- **Ends of an axis and bottom corners:** drag to move an end of the axis, or click an end of the axis to type its value.
- **Legend:** click a trace to show or hide it, double-click it to only show that trace, and hover it to highlight its trace.
- **Touch:** drag with one finger as with a mouse, or use two fingers to zoom and pan.
- **Keyboard** (once the plot has the focus): `+` and `−` to zoom in and out, `0` to reset the zoom, the arrow keys to pan, and Shift+F10 (or the context menu key) to open the context menu.
- **Escape**, or pressing another mouse button, cancels a drag.

Hovering shows the value of each visible trace at the X value under the mouse pointer. For a trace that is not a function of X (e.g., a phase plot), it shows the point closest to the mouse pointer instead.

The context menu can zoom in and out, reset the zoom, make an axis logarithmic, copy the plot to the clipboard, export it as JPEG, PNG, SVG, or WebP, and export its data to CSV.

### Theming

Set any of these CSS variables on an ancestor of the component. Each has a light and a dark default, based on [PrimeVue](https://primevue.org/)'s Aura theme:

| Variable | Used for |
|---|---|
| `--opencor-plot-background` | The background of the plot. |
| `--opencor-plot-text-color` | The axis titles and the legend. |
| `--opencor-plot-muted-text-color` | Tick labels, the hover guide line, hidden traces in the legend, and secondary text in overlays. |
| `--opencor-plot-primary-color` | The zoom box (and, by default, the keyboard focus ring). |
| `--opencor-plot-grid-color` | Grid lines. |
| `--opencor-plot-zero-line-color` | The zero lines. |
| `--opencor-plot-hidden-trace-color` | The legend swatch of a hidden trace. |
| `--opencor-plot-hover-background` | Hovered items (e.g., in the legend and context menu). |
| `--opencor-plot-overlay-background` | The background of the context menu and hover tooltip. |
| `--opencor-plot-overlay-border-color` | Their border. |
| `--opencor-plot-overlay-text-color` | Their text. |
| `--opencor-plot-overlay-shadow` | Their shadow. |
| `--opencor-plot-border-radius` | Rounded corners. |
| `--opencor-plot-focus-ring-width` | The width of the keyboard focus ring. |
| `--opencor-plot-focus-ring-color` | The colour of the keyboard focus ring (the primary colour by default). |

## Development

[Bun](https://bun.sh/) is required.

```bash
bun install          # Install the dependencies.
bun run build        # Build the library.
bun dev              # Run the demo app.
bun build:demo       # Build the demo app.
bun format           # Format the code.
bun format:check     # Check the code formatting (without fixing it).
bun lint             # Lint the code.
bun lint:check       # Lint the code (without fixing it).
bun test             # Run the tests.
bun test --coverage  # Run the tests with code coverage (which must be 100%).
bun test --watch     # Run the tests in watch mode.
bun typecheck        # Type check the code.
bun clean            # Remove all generated files.
```

```bash
bun dependencies:update  # Check for and update outdated dependencies.
bun version:new          # Bump the version number.
```

### Releasing

To publish a new version to [npm](https://www.npmjs.com/package/@opencor/plot), bump the version number (`bun version:new`), commit it, and push a tag named after it (i.e. `vX.YYYYMMDD.Z` for version `X.YYYYMMDD.Z`). Our [CD workflow](.github/workflows/cd.yml) then tests, builds and publishes it. It fails if the tag doesn't match the version in `package.json`.

## License

[Apache License 2.0](LICENSE.txt).
