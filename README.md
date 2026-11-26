# OpenCOR Plot

`@opencor/plot` is a [Vue 3](https://vuejs.org/) component for plotting data. It is used by [OpenCOR](https://opencor.ws/), but it can be used by any Vue 3 application.

Key characteristics:
- Built as a [Vue 3](https://vuejs.org/) component using the [Composition API](https://vuejs.org/guide/extras/composition-api-faq).
- Uses [uPlot](https://github.com/leeoniya/uPlot) under the hood, and draws traces using Canvas 2D.
- It does not rely on any UI framework (e.g., [PrimeVue](https://primevue.org/)) or CSS framework (e.g., [Tailwind CSS](https://tailwindcss.com/)).

Contents:
- [Installation](#installation)
- [Usage](#usage)
  - [Types](#types)
  - [Data](#data)
  - [Large and live data](#large-and-live-data)
  - [Props](#props)
  - [Events](#events)
  - [Methods](#methods)
  - [Interaction](#interaction)
  - [Theming](#theming)
- [Development](#development)
  - [Benchmarking](#benchmarking)
  - [Releasing](#releasing)
- [License](#license)

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
import OpenCORPlot, { type PlotData } from '@opencor/plot';
import '@opencor/plot/style.css';

const x = Float64Array.from({ length: 1000 }, (_, i) => i / 100);

const data: PlotData = {
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

### Types

The component is the default export of `@opencor/plot`, and is also exported as `OpenCORPlot`. These types are exported too:

| Type | Definition | Description |
|---|---|---|
| `PlotData` | `{ traces, xAxisTitle?, yAxisTitle?, xAxisRange?, yAxisRange? }` | The data to plot (see [Data](#data)). |
| `PlotTrace` | `{ name, x, y, xValue, yValue, color, traceId?, legendRank?, runLabel? }` | A trace to plot (see [Data](#data)). |
| `PlotMargins` | `{ left: number; right: number }` | The left and right margins (in pixels) of a plot, i.e. the space taken by its Y axis and legend (see the [`margins`](#props) prop and the [`marginsUpdated`](#events) event). |
| `PlotRanges` | `{ x: [number, number]; y: [number, number] }` | The current ranges of the axes of a plot (even if an axis is logarithmic, see the [`rangesUpdated`](#events) event and the [`setRanges()`](#methods) method). |
| `PlotTheme` | `'system' \| 'light' \| 'dark'` | The value of the [`theme`](#props) prop. |
| `PlotCsvExportEvent` | `PlotCsvExportStartedEvent \| PlotCsvExportProgressEvent \| PlotCsvExportFinishedEvent` | The payload of the [`csvExport`](#events) event. Use its `type` to tell which one it is. |
| `PlotCsvExportStartedEvent` | `{ type: 'started' }` | An export to CSV has started. |
| `PlotCsvExportProgressEvent` | `{ type: 'progress'; percent: number }` | An export to CSV has made some progress: `percent` goes from 0 to 100 (an integer). |
| `PlotCsvExportFinishedEvent` | `{ type: 'finished'; success: boolean }` | An export to CSV has finished, whether successfully (and the file was downloaded) or not. |
| `PlotImageExportEvent` | `{ action: 'copy' \| 'export'; format: 'jpeg' \| 'png' \| 'svg' \| 'webp'; success: boolean }` | The payload of the [`imageExport`](#events) event: whether the plot was copied to the clipboard (always as PNG) or exported to an image file, in which format, and whether it worked. |
| `PlotContextMenuEvent` | `{ clientX: number; clientY: number; usingKeyboard: boolean; items: ContextMenuItem[] }` | The payload of the [`contextMenu`](#events) event: where the context menu was requested (in client coordinates), whether it was requested using the keyboard (in which case the custom menu should take the keyboard focus), and the items that our context menu would have shown. These items reflect the plot as it was when the context menu was requested and don't get updated if the data changes while the custom context menu is shown, but their commands always act on the plot as it is when they are chosen. |
| `ContextMenuItem` | `ContextMenuAction \| ContextMenuSeparator` | An item of a context menu. |
| `ContextMenuAction` | `{ label: string; icon?: IconName; checked?: boolean; command?: () => void; items?: ContextMenuItem[] }` | An action: its `label`, its `icon`, whether it is checked (only for a checkable action, e.g. to make an axis logarithmic), the `command` to call when it is chosen, and its submenu `items`, if any. |
| `ContextMenuSeparator` | `{ separator: true }` | A separator. |
| `IconName` | `'angle-right' \| 'arrows-h' \| 'arrows-v' \| 'chart-line' \| 'check' \| 'copy' \| 'download' \| 'eye' \| 'image' \| 'pencil' \| 'refresh' \| 'search-minus' \| 'search-plus'` | The name of an icon (from [PrimeIcons](https://primevue.org/icons/)). |
| `PlotPointCounts` | `{ nbOfPoints: number; nbOfDrawnPoints: number }` | The value returned by the [`pointCounts()`](#methods) method. |
| `PlotMemoryUsage` | `{ levelOfDetail: number; logValues: number }` | The value returned by the [`memoryUsage()`](#methods) method. |

### Data

[`PlotData`](#types):

| Property | Type | Description |
|---|---|---|
| `traces` | [`PlotTrace`](#types)`[]` | The traces to plot. |
| `xAxisTitle`, `yAxisTitle` | `string` | The axis titles. |
| `xAxisRange`, `yAxisRange` | `[number, number]` | The range of an axis when the zoom is reset. By default, it fits the data. The current ranges can be followed using the [`rangesUpdated`](#events) event and set using the [`setRanges()`](#methods) method. |

[`PlotTrace`](#types):

| Property | Type | Description |
|---|---|---|
| `name` | `string` | The name of the trace, as shown in the legend, the hover tooltip, and the CSV export. |
| `x`, `y` | `Float64Array` | The X and Y values of the trace. |
| `xValue`, `yValue` | `string` | What the X and Y values are (e.g., the name of a model variable), used in the CSV export. |
| `color` | `string` | The colour of the trace. |
| `traceId` | `string` | An optional identifier that keeps the visibility of the trace when the data is updated. Otherwise, the trace is identified by its `name`, `xValue`, `yValue`, and `runLabel` (and, among traces that have the same ones, by their order), or by its position if it doesn't have a `name`, `xValue`, and `yValue`. |
| `legendRank` | `number` | The optional rank of the trace in the legend (lower ranks first, 1000 by default). |
| `runLabel` | `string` | An optional label that tells apart the X column of the trace from those of other runs in the CSV export. |

Notes:
- Titles and trace names can contain a little HTML (`b`, `br`, `code`, `em`, `i`, `strong`, `sub`, and `sup`). Anything else is removed.
- A trace can be a function of X (e.g., against time) or not (e.g., a phase plot). A point with a non-finite X or Y value (e.g., `NaN`) is a gap in its trace.
- A trace with fewer than 20 points is also drawn with markers.
- The zoom is kept when the data is updated, unless the axis titles change (i.e. something else is being plotted).

### Large and live data

The component only goes through the points that are needed for a trace to look the same, and draws it using only as many segments as are needed for it to look the same (within a quarter of a canvas pixel), so a trace with millions of points can be zoomed, panned, and hovered smoothly.

The data is updated by giving the component a new [`data`](#props) object, since changes made to an existing `data` object (e.g., to its `traces` array or to one of its traces) are not watched.

When the data is updated, the work that has already been done is reused if the new values of a trace are a *continuation* of its previous ones, i.e. a view of the same buffer, from the same offset, and at least as long. Only the new values (and the last of the previous values, which may have changed) then get processed. The very same arrays (i.e. not new views) are assumed not to have changed at all. So, for live data (e.g., while a simulation is running), allocate a buffer for all the values, fill it as values become available, and give the component a view of the part that is filled:

```ts
const xBuffer = new Float64Array(nbOfPoints);
const yBuffer = new Float64Array(nbOfPoints);

// Each time some new values have been added to the buffers:

data.value = {
  ...data.value,
  traces: [{ ...trace, x: xBuffer.subarray(0, nbOfValues), y: yBuffer.subarray(0, nbOfValues) }]
};
```

Also set the [`live`](#props) prop while the data is live, so that the last point of each visible trace gets marked, making its latest value easy to spot (even where a trace overlaps itself, e.g. in a phase plot).

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | [`PlotData`](#types) | (required) | The data to plot. |
| `showLegend` | `boolean` | `true` | Whether to show the legend. The legend takes at most 40% of the width of the plot (with long trace names truncated, and shown in full when hovered), and is hidden if the plot is too narrow for it to be useful. |
| `theme` | [`PlotTheme`](#types) | `'system'` | Whether to use light or dark mode, or whatever the system uses. |
| `margins` | [`PlotMargins`](#types) | | Margins shared with other plots, so that their plotting areas line up (see [`marginsUpdated`](#events)). |
| `appendTo` | `HTMLElement \| string` | `body` | Where to append our overlays (context menu, hover tooltip, etc.). |
| `customContextMenu` | `boolean` | `false` | Whether to emit a [`contextMenu`](#events) event rather than show our own context menu. To have no context menu at all, set it and don't handle the `contextMenu` event. |
| `levelOfDetail` | `boolean` | `true` | Whether to only go through the points that are needed for a trace to look the same when drawing it (see [Large and live data](#large-and-live-data)). Hovering a trace whose X values are sorted always does. Only meant to be disabled to see how much it helps. |
| `live` | `boolean` | `false` | Whether the data is live (e.g., while a simulation is running), in which case the last point of each visible trace is marked. |

To draw traces without our level of detail, use `:levelOfDetail="false"`. Our path builder then goes through every point of every trace (still only drawing the first, minimum, maximum, and last points of each pixel column, so that a trace looks the same) and draws all of those points (rather than only as many as are needed for a trace to look the same). Unlike uPlot's own, our path builder handles gaps (e.g., `NaN` values) and traces whose X values are not sorted (e.g., phase plots) at any number of points (splitting a path of more than 1,000,000 points into several paths, since Chrome draws nothing for a path of more than about 1,870,000 points), and in Firefox, it splits a path of more than 2,000 points into several paths, since Firefox only strokes a path quickly if it has no more than a few thousand points. This is also the reference that our optimisations can be benchmarked against.

### Events

| Event | Payload | Description |
|---|---|---|
| `marginsUpdated` | [`PlotMargins`](#types) | The margins that the plot needs have changed. To line up several plots, pass the largest left and right margins of all of them to each plot's [`margins`](#props) prop. |
| `rangesUpdated` | [`PlotRanges`](#types) | The current ranges of the axes have changed (e.g., after zooming, panning, or resetting the zoom, or after the data has been updated while an axis is autoranged). To link the X axes of several plots, pass the `x` range of one of them to the [`setRanges()`](#methods) method of the others. |
| `csvExport` | [`PlotCsvExportEvent`](#types) | An export to CSV has `'started'`, made `'progress'` (with a `percent`), or `'finished'` (with whether it was a `success`), so that its progress can be shown. |
| `imageExport` | [`PlotImageExportEvent`](#types) | The plot has been copied to the clipboard or exported to an image (or has failed to be), so that the user can be told about it. |
| `contextMenu` | [`PlotContextMenuEvent`](#types) | Only with [`customContextMenu`](#props): the context menu was requested at `clientX`/`clientY`, with the `items` that our context menu would have shown. If `usingKeyboard` is true, the custom menu should take the keyboard focus. |

### Methods

Available through a template ref:

| Method | Description |
|---|---|
| `resetMargins()` | Emit [`marginsUpdated`](#events) again, e.g. after the shared margins have been reset. |
| `setRanges(ranges)` | Zoom into the given [`PlotRanges`](#types) (e.g., `{ x: [0, 10] }`), leaving the axes without a range as they are. Like a zoom by the user, they are kept when the data is updated. They are ignored if any of them is not valid (e.g., if its minimum is not smaller than its maximum or, for a logarithmic axis, if it is not positive). |
| `contextMenuHidden()` | Tell the plot that a custom context menu (see [`contextMenu`](#events)) has been hidden, so that it can get the keyboard focus back. |
| `pointCounts()` | The number of points of the visible traces (`nbOfPoints`), and how many of them were last drawn (`nbOfDrawnPoints`), as a [`PlotPointCounts`](#types). Meant for testing and benchmarking. |
| `memoryUsage()` | The memory (in bytes) used by the component itself, not counting the data, as a [`PlotMemoryUsage`](#types): by its levels of detail (`levelOfDetail`) and by the logarithm of its values along logarithmic axes (`logValues`). Meant for testing and benchmarking. |

### Interaction

Like with [Plotly](https://plotly.com/javascript/):
- **Plotting area:** drag to zoom (along one axis if the drag is mostly horizontal or vertical), Shift+drag to pan, use the mouse wheel to zoom around the mouse pointer, and double-click to reset the zoom.
- **Middle of an axis:** drag to pan along that axis, use the mouse wheel to zoom along it, and double-click to reset its zoom.
- **Ends of an axis and bottom corners:** drag to move an end of the axis, or click an end of the axis to type its value.
- **Legend:** click a trace to show or hide it, double-click it to only show that trace (or all the traces again), and hover it to highlight its trace. Its context menu (right-click, or Shift+F10 once it has the focus) can also show only that trace (or all the traces again), or show or hide it if it is the only trace.
- **Touch:** drag with one finger as with a mouse, or use two fingers to zoom and pan.
- **Keyboard** (once the plot has the focus): `+` and `−` to zoom in and out, `0` to reset the zoom, the arrow keys to pan, and Shift+F10 (or the context menu key) to open the context menu (e.g., to type the value of an end of an axis). Each legend item can also get the focus: Enter or Space shows or hides its trace, and Shift+F10 opens its context menu.
- **Escape**, or pressing another mouse button, cancels a drag.

Hovering shows the value of each visible trace at the X value under the mouse pointer. For a trace that is not a function of X (e.g., a phase plot), it shows the point closest to the mouse pointer instead.

The context menu can zoom in and out, reset the zoom, edit the range of an axis, make an axis logarithmic, copy the plot to the clipboard, export it as JPEG, PNG, SVG, or WebP, and export its data to CSV. When requested from a legend item, it can also show only that trace (or all the traces again), or show or hide it if it is the only trace.

Copied and exported images always use the light colours (white background, dark text), whatever the current theme, since they are typically used in light documents.

### Theming

Set any of these CSS variables on an ancestor of the component. Each has a light and a dark default, based on [PrimeVue](https://primevue.org/)'s Aura theme. They don't affect copied and exported images, which always use the light defaults:

| Variable | Used for |
|---|---|
| `--opencor-plot-background` | The background of the plot. |
| `--opencor-plot-text-color` | The axis titles, the legend, and the ring around the last point of a live trace. |
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
bun test --coverage  # Run the tests with code coverage.
bun test --watch     # Run the tests in watch mode.
bun typecheck        # Type check the code.
bun clean            # Remove all generated files.
```

```bash
bun benchmark            # Benchmark the plot (see below).
bun dependencies:update  # Check for and update outdated dependencies.
bun version:new          # Bump the version number.
```

### Benchmarking

`bun benchmark` builds the demo app, serves it, and runs its benchmark (i.e. what its **Benchmark** button does) in one or more browsers, for a set of scenarios. Its results get saved as a report in `benchmark-results/`, named after when the benchmark was run, as HTML (to be opened in a browser), Markdown (e.g., to be pasted in an issue), and JSON (e.g., to be compared with other results). The report is updated as results come in, so it is there even if the benchmark gets interrupted.

```bash
bun benchmark                                       # All the browsers and scenarios.
bun benchmark --browsers chrome                     # Only Chrome.
bun benchmark --scenarios noisy-3x1m,unsorted-3x1m  # Only some scenarios (see bun benchmark --list).
bun benchmark --output ~/results                    # Save the report somewhere else.
bun benchmark --help                                # All the options.
```

Requirements:
- **Chrome and Firefox:** they must be installed, and are driven using [Puppeteer](https://pptr.dev/). Chrome runs headless (unless `--headed` is given), but a Firefox window opens, since headless Firefox doesn't draw using the GPU and caps its frame rate.
- **Safari** (macOS only): it is driven using `safaridriver`, which must be enabled once, using `safaridriver --enable` and Safari's **Develop › Allow Remote Automation** menu item (the **Develop** menu can be shown in Safari's **Advanced** settings). A Safari window opens.
- **Browsers:** by default, Chrome, Firefox, and (on macOS) Safari are used, skipping those that cannot be launched (e.g., if they are not installed).
- **Time:** each scenario takes about 40 seconds, so all of them take about 10 minutes per browser (i.e. about half an hour for all three browsers). Don't use the computer in the meantime, since it would affect the results. On macOS, the benchmark keeps the display on while it runs (browsers stop drawing when the display is off), and refuses to start if the screen is locked.

A scenario is a kind of data (e.g., `noisy` sine waves or `unsorted` Lissajous curves, like in the demo app) with a number of plots, traces, and points (e.g., `noisy-16-plots-3x100k` is 16 plots of 3 noisy traces of 100,000 points). For each scenario, the benchmark zooms the plots in and out, pans them at a zoom of 1×, 10×, and 100× (the more zoomed in, the fewer the visible points), plots their data live (as if it was being generated), and resizes them, each for 5 seconds.

Reading the results:
- **Header:** each table is preceded by the browser's version, the GPU, and the device pixel ratio.
- **Cells:** the frame rate, and the average and 95th percentile of the redraw time (e.g., `800 FPS, 1.2/2.0 ms`). The redraw time is the time it takes to redraw all the plots in a frame, including the browser rendering the frame. The lower, the better, and a 95th percentile much higher than the average means occasional stutters. At 60 Hz, a frame lasts 16.7 ms.
- **Frame rate:** in Chrome and Firefox, it is not capped by the refresh rate of the display (unless `--capped` is given), so it tells how fast the plots can be redrawn. In Safari (or with `--capped`), it is capped by the refresh rate of the display, so compare redraw times instead.
- **First draw:** the time from giving the data to the plots to them having drawn it, which includes creating the plots, processing the data, and building the levels of detail.

The results depend on the computer, the browser (and its version), and the display, so only compare results from the same computer. To measure the effect of a change, run the same scenarios before and after it.

### Releasing

To publish a new version to [npm](https://www.npmjs.com/package/@opencor/plot), bump the version number (`bun version:new`), commit it, and push a tag named after it (i.e. `vX.YYYYMMDD.Z` for version `X.YYYYMMDD.Z`). Our [CD workflow](.github/workflows/cd.yml) then tests, builds and publishes it. It fails if the tag doesn't match the version in `package.json`.

## License

[Apache License 2.0](LICENSE.txt).
