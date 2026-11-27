<template>
  <div class="opencor-plot-theme plot-widget" :class="{ 'opencor-plot-dark-mode': isDarkMode }">
    <div ref="mainDivRef" class="plot-panel"
      :style="{
        backgroundColor: themeColors.background,
        color: themeColors.text
      }"
      @contextmenu="onContextMenu"
    >
      <!--
      Note: our plot can be focused, so that it can be used with the keyboard (see onPlotKeyDown()), in which case it is
            described to assistive technologies as an application (i.e. a plot, see aria-roledescription), so that they
            pass our keys (e.g., the arrow keys to pan) to us rather than use them to navigate the page.
      -->
      <div ref="plotDivRef" class="plot-area"
        tabindex="0"
        role="application"
        aria-roledescription="plot"
        :aria-label="plotLabel"
        :aria-describedby="plotDescriptionId"
        @keydown="onPlotKeyDown"
      />
      <span :id="plotDescriptionId" class="visually-hidden">Press + or − to zoom in or out, 0 to reset the zoom, the arrow keys to pan, and Shift+F10 for more options (e.g., to edit the range of an axis or to export the plotted data to CSV).</span>
      <span :id="legendDescriptionId" class="visually-hidden">Press Shift+F10 to show only this trace (or all the traces again).</span>
      <svg v-if="zoomBox && plotRect" class="zoom-box"
        :style="{ left: `${plotRect.left}px`, top: `${plotRect.top}px` }"
        :width="plotRect.width"
        :height="plotRect.height"
      >
        <rect
          :x="zoomBox.x"
          :y="zoomBox.y"
          :width="zoomBox.width"
          :height="zoomBox.height"
          :style="{ fill: themeColors.zoomFill, stroke: themeColors.zoomStroke }"
          :stroke-width="zoomBox.strokeWidth"
        />
      </svg>
      <template v-if="plotRect">
        <div v-for="dragger in draggers" :key="dragger.type" class="dragger"
          :style="{
            left: `${dragger.left}px`,
            top: `${dragger.top}px`,
            width: `${dragger.width}px`,
            height: `${dragger.height}px`,
            cursor: `${dragger.type}-resize`
          }"
          @pointerdown="onDragStart($event, dragger.type)"
          @mousedown="onPressMouseDown"
          @dblclick="onDoubleClick(dragger.type)"
          @wheel="onWheel($event, dragger.type)"
        />
        <div v-if="rangeEditor" ref="rangeEditorRef" class="range-editor"
          contenteditable="true"
          role="textbox"
          :aria-label="rangeEditorLabel"
          spellcheck="false"
          :style="{
            left: `${rangeEditor.left}px`,
            top: `${rangeEditor.top}px`,
            transform: rangeEditor.transform,
            color: themeColors.text,
            backgroundColor: themeColors.background
          }"
          @keydown="onRangeEditorKeyDown"
          @blur="closeRangeEditor(true)"
        >{{ rangeEditor.text }}</div>
        <div v-if="data.xAxisTitle" ref="xAxisTitleRef" class="axis-title"
          :style="{
            left: `${plotRect.left + 0.5 * plotRect.width}px`,
            top: `${plotRect.top + plotRect.height + X_AXIS_SIZE_WITH_TITLE}px`,
            fontSize: `${TITLE_FONT_SIZE}px`,
            transform: 'translateX(-50%)'
          }"
          v-html="common.sanitiseHtml(data.xAxisTitle)"
        />
        <div v-if="data.yAxisTitle" ref="yAxisTitleRef" class="axis-title"
          :style="{
            left: `${Y_AXIS_TITLE_SIZE - Y_AXIS_TITLE_GAP - TITLE_FONT_SIZE}px`,
            top: `${plotRect.top + 0.5 * plotRect.height}px`,
            fontSize: `${TITLE_FONT_SIZE}px`,
            writingMode: 'vertical-rl',
            transform: 'translateY(-50%) rotate(180deg)'
          }"
          v-html="common.sanitiseHtml(data.yAxisTitle)"
        />
      </template>
      <PlotLivePointsWidget ref="livePointsRef" :backgroundColor="themeColors.background" :textColor="themeColors.text" />
      <svg v-if="hover && plotRect" class="hover-overlay"
        :style="{ left: `${plotRect.left}px`, top: `${plotRect.top}px` }"
        :width="plotRect.width"
        :height="plotRect.height"
      >
        <line :x1="hover.guideX" :x2="hover.guideX" y1="0" :y2="plotRect.height"
          :style="{ stroke: themeColors.hoverGuide }"
          :stroke-width="hover.guideWidth"
        />
        <circle v-for="point in hover.points" :key="point.seriesIndex" :cx="point.x" :cy="point.y" :r="HOVER_POINT_RADIUS"
          :style="{ fill: point.color, stroke: themeColors.background }"
          stroke-width="2"
        />
      </svg>
      <div v-if="legendShown" ref="legendRef" class="legend"
        :style="{
          left: `${legendLeft}px`,
          maxWidth: legendMaxWidth ? `${legendMaxWidth}px` : undefined,
          top: `${plotRect?.top ?? 0}px`,
          maxHeight: plotRect ? `${plotRect.height}px` : undefined,
          visibility: plotRect ? undefined : 'hidden',
          backgroundColor: themeColors.background,
          fontSize: `${LEGEND_FONT_SIZE}px`
        }"
      >
        <!--
        Note: our legend items are toggle buttons, which are pressed when their trace is shown, so that they can be used
              with the keyboard and their state is known to assistive technologies.
        -->
        <button v-for="legendItem in legendItems" :key="legendItem.index" class="legend-item" :class="{ 'legend-item-hidden': !legendItem.visible }"
          type="button"
          :aria-pressed="legendItem.visible"
          :aria-describedby="legendDescriptionId"
          :data-legend-index="legendItem.index"
          @click="onLegendClick($event, legendItem.index)"
          @keydown="onLegendKeyDown($event, legendItem.index)"
          @dblclick="onLegendDoubleClick(legendItem.index)"
          @pointerenter="onLegendPointerEnter($event, legendItem.index, legendItem.name)"
          @pointerleave="highlightTrace(null)"
          @focus="onLegendFocus($event, legendItem.index)"
          @blur="highlightTrace(null)"
        >
          <span class="legend-swatch" :class="{ 'legend-swatch-dashed': legendItem.dash.length }"
            :style="{
              color: legendItem.visible ? legendItem.color : themeColors.hiddenTrace,
              backgroundImage: dashGradient(legendItem.dash) || undefined
            }"
          >
            <span v-if="legendItem.markers" class="legend-marker" />
          </span>
          <span v-html="common.sanitiseHtml(legendItem.name)" />
        </button>
      </div>
    </div>
    <ContextMenuWidget v-if="!customContextMenu" ref="contextMenuRef" :items="contextMenuItems" :appendTo="appendTo" :darkMode="isDarkMode" :themeStyle="overlayThemeStyle" @hide="onContextMenuHide" />
    <Teleport v-if="hover" :to="appendTo ?? 'body'">
      <div ref="hoverTooltipRef" class="opencor-plot-theme hover-tooltip" :class="{ 'opencor-plot-dark-mode': isDarkMode }" :style="overlayThemeStyle">
        <div class="hover-tooltip-header">
          <span v-if="data.xAxisTitle" class="hover-tooltip-name" v-html="common.sanitiseHtml(data.xAxisTitle)" />
          <span class="hover-tooltip-value">{{ hover.x }}</span>
        </div>
        <div v-for="row in hover.rows" :key="row.seriesIndex" class="hover-tooltip-row">
          <span class="hover-tooltip-swatch" :style="{ backgroundColor: row.color }" />
          <span class="hover-tooltip-name" v-html="common.sanitiseHtml(row.name)" />
          <span class="hover-tooltip-value">{{ row.value }}</span>
        </div>
        <div v-if="hover.otherRows" class="hover-tooltip-other-rows">+{{ hover.otherRows }} more</div>
      </div>
    </Teleport>
    <Teleport v-if="dragCursor" :to="appendTo ?? 'body'">
      <div class="drag-cursor-overlay" :style="{ cursor: dragCursor }" @wheel.prevent />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import uPlot from 'uplot';
import * as vue from 'vue';

import 'uplot/dist/uPlot.min.css';

import { createChunkedPath, MAX_PATH_POINTS } from '../common/chunkedPathUtils';
import * as common from '../common/common';
import * as levelOfDetailUtils from '../common/levelOfDetailUtils';
import { dashGradient, dotLength, type LineStyle, lineDash, validLineWidth } from '../common/lineStyleUtils';
import * as pathLevelOfDetailUtils from '../common/pathLevelOfDetailUtils';
import { isValidRange, pinchedRange, type Range, scaledRange } from '../common/rangeUtils';
import { SimplifiedPath, TraceSmoothness } from '../common/simplifiedPathUtils';
import { roundDTick, ticksBetween } from '../common/ticksUtils';
import {
  type LogValues,
  type ValuesStatistics,
  isContinuationOf,
  logValues,
  valuesStatistics
} from '../common/traceValues';
import { isolatedTraceVisibilities, legendTraceAction, toggledTraceVisibilities } from '../common/traceVisibilityUtils';

import '../assets/theme.css';

import ContextMenuWidget, { type ContextMenuItem } from './ContextMenuWidget.vue';
import PlotLivePointsWidget, { type PlotLivePoint } from './PlotLivePointsWidget.vue';

/**
 * A trace to plot, which can be a function of X (e.g., against time) or not (e.g., a phase plot). A trace with fewer
 * than 20 points is also drawn with markers.
 */

export interface PlotTrace {
  /**
   * The name of the trace, as shown in the legend, the hover tooltip, and the CSV export. It can contain a little HTML
   * (`b`, `br`, `code`, `em`, `i`, `strong`, `sub`, and `sup`). Anything else is removed.
   */
  name: string;
  /**
   * An optional identifier that keeps the visibility of the trace when the data is updated. Otherwise, the trace is
   * identified by its `name`, `xValue`, `yValue`, and `runLabel` (and, among traces that have the same ones, by their
   * order), or by its position if it doesn't have a `name`, `xValue`, and `yValue`.
   */
  traceId?: string;
  /** What the X values are (e.g., the name of a model variable), used in the CSV export. */
  xValue: string;
  /**
   * The X values of the trace. A point with a non-finite X value (e.g., `NaN`) is a gap in the trace. For live data,
   * see {@link https://github.com/opencor/plot#large-and-live-data | Large and live data}.
   */
  x: Float64Array;
  /** What the Y values are (e.g., the name of a model variable), used in the CSV export. */
  yValue: string;
  /**
   * The Y values of the trace. A point with a non-finite Y value (e.g., `NaN`) is a gap in the trace. For live data,
   * see {@link https://github.com/opencor/plot#large-and-live-data | Large and live data}.
   */
  y: Float64Array;
  /** The colour of the trace, as a CSS colour (e.g., `'#1f77b4'`). */
  color: string;
  /** The optional style of the line of the trace (see `PlotLineStyle`, `'solid'` by default). */
  lineStyle?: PlotLineStyle;
  /** The optional width of the line of the trace (in CSS pixels, 2 by default). */
  lineWidth?: number;
  /** The optional rank of the trace in the legend (lower ranks first, 1000 by default). */
  legendRank?: number;
  /** An optional label that tells apart the X column of the trace from those of other runs in the CSV export. */
  runLabel?: string;
}

/**
 * The style of the line of a trace, i.e. one of the line types of SED-ML's `Line` (except `none`). Its dashes and gaps
 * scale with the width of the line, so that a thick line looks right.
 */

export type PlotLineStyle = LineStyle;

/**
 * The data to plot. It is not watched, so to update it, give the plot a new `PlotData` object (see
 * {@link https://github.com/opencor/plot#large-and-live-data | Large and live data}).
 */

export interface PlotData {
  /** The title of the X axis. It can contain a little HTML (see `PlotTrace.name`). */
  xAxisTitle?: string;
  /** The title of the Y axis. It can contain a little HTML (see `PlotTrace.name`). */
  yAxisTitle?: string;
  /** The range of the X axis when the zoom is reset. By default, it fits the data. */
  xAxisRange?: [number, number];
  /** The range of the Y axis when the zoom is reset. By default, it fits the data. */
  yAxisRange?: [number, number];
  /** The traces to plot. */
  traces: PlotTrace[];
}

/**
 * The left and right margins of a plot, i.e. the space taken by its Y axis and legend. To line up several plots, pass
 * the largest left and right margins that their `marginsUpdated` events gave to the `margins` prop of each of them.
 */

export interface PlotMargins {
  /** The left margin (in pixels), i.e. the space taken by the Y axis and its title. */
  left: number;
  /** The right margin (in pixels), i.e. the space taken by the legend. */
  right: number;
}

/** The payload of the `csvExport` event when an export to CSV has started. */

export interface PlotCsvExportStartedEvent {
  type: 'started';
}

/** The payload of the `csvExport` event when an export to CSV has made some progress. */

export interface PlotCsvExportProgressEvent {
  type: 'progress';
  /** How far the export to CSV has got, from 0 to 100 (an integer). */
  percent: number;
}

/** The payload of the `csvExport` event when an export to CSV has finished. */

export interface PlotCsvExportFinishedEvent {
  type: 'finished';
  /** Whether the export to CSV was successful (and the file was downloaded). */
  success: boolean;
}

/**
 * The payload of the `csvExport` event, which can be used to show the progress of an export to CSV. Use its `type` to
 * tell which one it is.
 */

export type PlotCsvExportEvent = PlotCsvExportStartedEvent | PlotCsvExportProgressEvent | PlotCsvExportFinishedEvent;

/**
 * The payload of the `imageExport` event, which is emitted once the plot has been copied to the clipboard or exported
 * to an image (or has failed to be), so that the user can be told about it.
 */

export interface PlotImageExportEvent {
  /** Whether the plot was copied to the clipboard (`'copy'`) or exported to an image file (`'export'`). */
  action: 'copy' | 'export';
  /** The format of the image, which is always PNG when copying to the clipboard. */
  format: 'jpeg' | 'png' | 'svg' | 'webp';
  /** Whether the plot was copied to the clipboard or exported (and its file downloaded). */
  success: boolean;
}

/** The value of the `theme` prop, i.e. whether to use light or dark mode, or whatever the system uses. */

export type PlotTheme = 'system' | 'light' | 'dark';

/**
 * The value returned by the `pointCounts()` method, i.e. how much drawing only the points that are needed for the
 * traces to look the same helps. Mainly meant for testing and benchmarking.
 */

export interface PlotPointCounts {
  /** The number of points of the visible traces. */
  nbOfPoints: number;
  /** The number of those points that got drawn the last time the plot got drawn. */
  nbOfDrawnPoints: number;
}

/**
 * The value returned by the `memoryUsage()` method, i.e. the memory (in bytes) used by the plot itself, not counting
 * its data. Mainly meant for testing and benchmarking.
 */

export interface PlotMemoryUsage {
  /** The memory used by the levels of detail of the traces and the buffers of their selected points. */
  levelOfDetail: number;
  /** The memory used by the decimal logarithm of the values along logarithmic axes. */
  logValues: number;
}

/**
 * The payload of the `contextMenu` event, which is emitted rather than showing our context menu when the
 * `customContextMenu` prop is set, so that a custom context menu can be shown instead. Once it has been hidden, call
 * the `contextMenuHidden()` method, so that the plot can get the keyboard focus back, if needed.
 */

export interface PlotContextMenuEvent {
  /** The X coordinate (in client coordinates) where the context menu was requested. */
  clientX: number;
  /** The Y coordinate (in client coordinates) where the context menu was requested. */
  clientY: number;
  /**
   * Whether the context menu was requested using the keyboard (i.e. Shift+F10 or the context menu key), in which case
   * the custom context menu should get the keyboard focus, so that it can be used with the keyboard straight away.
   */
  usingKeyboard: boolean;
  /**
   * The items of our context menu, including their state (e.g., whether an axis is logarithmic) and their command
   * (e.g., to zoom in around where the context menu was requested). They reflect the plot as it was when the context
   * menu was requested and don't get updated if the data changes while the custom context menu is shown, but their
   * commands always act on the plot as it is when they are chosen.
   */
  items: ContextMenuItem[];
}

const props = withDefaults(
  defineProps<{
    /** The data to plot (see `PlotData`). */
    data: PlotData;
    /** Margins shared with other plots, so that their plotting areas line up (see the `marginsUpdated` event). */
    margins?: PlotMargins;
    /**
     * Whether to show the legend (`true` by default). The legend takes at most 40% of the width of the plot (with long
     * trace names truncated, and shown in full when hovered), and is hidden if the plot is too narrow for it to be
     * useful.
     */
    showLegend?: boolean;
    /** Whether to use light or dark mode, or whatever the system uses (`'system'` by default). */
    theme?: PlotTheme;
    /** Where to append our overlays, i.e. our context menu, hover tooltip, and drag cursor (`'body'` by default). */
    appendTo?: HTMLElement | string;
    /**
     * Whether to emit a `contextMenu` event rather than show our own context menu (`false` by default). To have no
     * context menu at all, set it and don't handle the `contextMenu` event.
     */
    customContextMenu?: boolean;
    /**
     * Whether to only go through the points that are needed for a trace to look the same when drawing it, and to only
     * draw as many segments as are needed for it to look the same (`true` by default). Hovering a trace whose X values
     * are sorted always does the former. Only meant to be disabled to see how much it helps.
     */
    levelOfDetail?: boolean;
    /**
     * Whether the data is live (e.g., while a simulation is running), in which case the last point of each visible
     * trace is marked, making its latest value easy to spot (`false` by default).
     */
    live?: boolean;
  }>(),
  {
    showLegend: true,
    theme: 'system',
    customContextMenu: false,
    levelOfDetail: true,
    live: false
  }
);

// Note: the JSDoc comments of our events don't make it into our type declarations (since Vue transforms their type),
//       which is why those of their payload types (e.g., PlotCsvExportEvent) also describe them.

const emit = defineEmits<{
  /**
   * Only with the `customContextMenu` prop: the context menu was requested, so that a custom context menu can be shown
   * instead of ours (see `PlotContextMenuEvent`).
   */
  contextMenu: [event: PlotContextMenuEvent];
  /** An export to CSV has started, made some progress, or finished, so that its progress can be shown. */
  csvExport: [event: PlotCsvExportEvent];
  /**
   * The plot has been copied to the clipboard or exported to an image (or has failed to be), so that the user can be
   * told about it (see `PlotImageExportEvent`).
   */
  imageExport: [event: PlotImageExportEvent];
  /**
   * The margins that the plot needs have changed. To line up several plots, pass the largest left and right margins of
   * all of them to the `margins` prop of each of them.
   */
  marginsUpdated: [newMargins: PlotMargins];
}>();

// Some constants (in CSS pixels, where relevant).
// Note: we want to behave like Plotly, so many of these constants are either Plotly's defaults (see
//       https://plotly.com/javascript/reference/) or what we used to give Plotly. However, we want to look more modern,
//       so we use OpenCOR's font (rather than Plotly's) with font sizes of our own.

const TICK_FONT_SIZE = 11; // Font size of our tick labels.
const TITLE_FONT_SIZE = 13; // Font size of our axis titles.
const LEGEND_FONT_SIZE = 12; // Font size of our legend items.
const LEGEND_LEFT_MARGIN = 8; // Margin between our plotting area and our legend.
const LEGEND_RIGHT_MARGIN = 8; // Margin between our legend (or last X tick label) and the right edge of our container.
const LEGEND_MAX_WIDTH_RATIO = 0.4; // Maximum width of our legend, relative to the width of our container.
const LEGEND_MIN_WIDTH = 96; // Minimum width of our legend (i.e. about 8 characters), or we hide it.
const DEFAULT_LEGEND_RANK = 1000; // Like Plotly's default legend rank.
const LEGEND_DOT_LENGTH = 2; // Length of a dot in our legend swatches, so that all our line styles can be told apart.
const X_TICK_LABEL_BASELINE = TICK_FONT_SIZE + 1; // Like Plotly, the distance to the baseline of our X tick labels.
const Y_TICK_LABEL_GAP = 1; // Like Plotly, the gap between our plotting area and our Y tick labels.
const Y_TICK_LABEL_BASELINE = 0.35 * TICK_FONT_SIZE; // Like Plotly, the distance from a tick to its label's baseline.
const TICK_LABEL_HALF_HEIGHT = 6; // Used to hide a Y tick label that would (partly) be above our container.
const X_AXIS_SIZE_WITH_TITLE = 18; // Size of our X axis (without its title) if it has a title.
const X_AXIS_SIZE_WITHOUT_TITLE = 20; // Size of our X axis if it doesn't have a title.
const X_AXIS_TITLE_SIZE = 17; // Size of our X axis title.
const Y_AXIS_TITLE_SIZE = 17; // Size of our Y axis title.
const Y_AXIS_TITLE_GAP = 1.5; // Gap between our Y axis title and (the left edge of) our Y axis.
const Y_AXIS_EXTRA_SIZE = 5; // Extra size of our Y axis, on top of the width of its tick labels.
const TICK_MIN_X_SPACING = 80; // Target spacing between two consecutive ticks along the X axis.
const TICK_MIN_Y_SPACING = 40; // Target spacing between two consecutive ticks along the Y axis.
const TICK_LABEL_MIN_SPACING = 10; // Minimum spacing between two consecutive tick labels.
const LINE_WIDTH = 2; // Like Plotly, the width of our traces' lines (in CSS pixels).
const MARKER_SIZE = 6; // Like Plotly, the size of our markers (in CSS pixels).
const MARKER_PADDING = Math.max(MARKER_SIZE / 1.6, 3); // Autorange padding for markers (in CSS pixels).
const MIN_NB_OF_POINTS_WITHOUT_MARKERS = 20; // Like Plotly, traces with fewer than 20 points also have markers.
const AUTORANGE_PADDING = 0.05; // Autorange padding (as a fraction of the length of an axis).
const DEFAULT_X_RANGE: [number, number] = [-1, 6]; // Like Plotly, the default X range.
const DEFAULT_Y_RANGE: [number, number] = [-1, 4]; // Like Plotly, the default Y range.
const MIN_DRAG = 8; // Like Plotly, the minimum distance that we must drag for it not to be a click (e.g., to zoom).
const MIN_ZOOM = 20; // Like Plotly, the distance below which a drag is considered to be along one axis only.
const ZOOM_FACTOR = 0.5; // Factor by which our ranges get scaled when zooming in (or its inverse when zooming out).
const ZOOM_ANIMATION_DURATION = 250; // Duration of our zoom animations (in milliseconds).
const WHEEL_ZOOM_ANIMATION_DURATION = 100; // Duration of our wheel zoom animations (in milliseconds).
const DRAGGER_SIZE = 20; // Like Plotly, the thickness of our axis (and corner) draggers.
const AXIS_DRAGGER_OFFSET = 0.5; // Like Plotly, the distance between our plotting area and our axis draggers.
const HIGHLIGHT_FADED_ALPHA = 0.2; // Opacity of our traces that are not highlighted when one of them is.
const HOVER_DISTANCE = 20; // Like Plotly, the maximum distance between the mouse pointer and a point to hover it.
const HOVER_LINE_RADIUS = 0.5; // Like Plotly, the "radius" of a point without a marker when hovering it.
const HOVER_POINT_RADIUS = 4; // Radius of the points that we highlight when hovering our traces.
const HOVER_TOOLTIP_OFFSET = 16; // Distance between the mouse pointer and our hover tooltip.
const HOVER_TOOLTIP_MARGIN = 4; // Minimum distance between our hover tooltip and the edges of the window.
const HOVER_TOOLTIP_MAX_ROWS = 12; // Maximum number of traces listed in our hover tooltip.
const CSV_EXPORT_YIELD_INTERVAL = 25; // Time (in milliseconds) after which we yield to the browser in a CSV export.

// Resize handling.

const resize = (): void => {
  // Resize our plot to fit its container, if it has a valid size.

  const width = mainDivRef.value?.clientWidth || 0;
  const height = mainDivRef.value?.clientHeight || 0;

  if (width <= 0 || height <= 0) {
    return;
  }

  containerWidth.value = width;

  // Update our plot or its size, if needed.

  if (!plot || isPlotOutdated) {
    updatePlot();
  } else if (plot.width !== width || plot.height !== height) {
    setPlotSize(plot, width, height);
  }
};

const relayoutPlot = (): void => {
  // Lay out our plot again (e.g., when our right margin changes), at the size of our container rather than at its
  // current size, since our plot may have been enlarged for our previous layout (see our setSize hook in createPlot()),
  // in which case it would otherwise remain enlarged (e.g., if our legend gets hidden when our container gets
  // narrower).

  const width = mainDivRef.value?.clientWidth || 0;
  const height = mainDivRef.value?.clientHeight || 0;

  if (plot && width > 0 && height > 0) {
    setPlotSize(plot, width, height);
  }
};

const resetMargins = (): void => {
  // Forget the margins that we last emitted, so that we emit our current margins (e.g., when the shared margins we are
  // given have been reset).

  trackedMargins = undefined;

  updateMarginsAsync();
};

const contextMenuHidden = (): void => {
  // Our custom context menu has been hidden (see PlotContextMenuEvent), so do as if it was our context menu.

  onContextMenuHide();
};

const pointCounts = (): PlotPointCounts => {
  // Return the number of points of our visible traces and the number of them that actually got drawn the last time our
  // plot got drawn (see PlotPointCounts).
  // Note #1: this is not reactive since it would otherwise trigger a Vue update every time our plot gets drawn (e.g.,
  //          while zooming or panning), i.e. it is meant to be polled.
  // Note #2: the points of a trace that got drawn are those that we went through to build its path, even though only
  //          some of them may end up in it (see linearPath()), since that is what drawing it costs. Also, all the
  //          markers of a trace get drawn, if it has some (see markerPath()).

  const res: PlotPointCounts = { nbOfPoints: 0, nbOfDrawnPoints: 0 };

  if (!plot) {
    return res;
  }

  for (let seriesIndex = 1; seriesIndex < plot.series.length; ++seriesIndex) {
    const [xValues, yValues] = seriesData(plot, seriesIndex) ?? [];

    if (!plot.series[seriesIndex]?.show || !xValues || !yValues) {
      continue;
    }

    const nbOfPoints = Math.min(xValues.length, yValues.length);

    res.nbOfPoints += nbOfPoints;
    res.nbOfDrawnPoints += hasMarkers(xValues, yValues) ? nbOfPoints : (drawnPoints[seriesIndex - 1] ?? 0);
  }

  return res;
};

const memoryUsage = (): PlotMemoryUsage => {
  // Return the number of bytes that we use for our own purposes (see PlotMemoryUsage).
  // Note #1: like pointCounts(), this is not reactive, i.e. it is meant to be polled.
  // Note #2: our statistics (see plotValues()) only use a few bytes per trace, so we don't count them.

  const res: PlotMemoryUsage = {
    levelOfDetail: selectionXValues.byteLength + selectionYValues.byteLength,
    logValues: 0
  };

  for (const lod of traceLods) {
    if (lod) {
      res.levelOfDetail += levelOfDetailUtils.memoryUsage(lod);
    }
  }

  for (const lod of pathLods) {
    if (lod) {
      res.levelOfDetail += pathLevelOfDetailUtils.memoryUsage(lod);
    }
  }

  for (const arrays of Object.values(plottedArrays)) {
    for (const arrayValues of arrays.values()) {
      for (const offsetValues of arrayValues.values()) {
        for (const plotted of offsetValues) {
          res.logValues += plotted.log?.buffer.byteLength ?? 0;
        }
      }
    }
  }

  return res;
};

// Note: we give the type of our methods explicitly, so that their JSDoc comments make it into our type declarations.

/** The methods of the plot, which are available through a template ref. */

interface PlotMethods {
  /**
   * Tell the plot that a custom context menu (see the `contextMenu` event) has been hidden, so that it can get the
   * keyboard focus back, if needed.
   */
  contextMenuHidden: () => void;
  /**
   * Return the memory (in bytes) used by the plot itself, not counting its data. It is not reactive, i.e. it is meant
   * to be polled. Mainly meant for testing and benchmarking.
   */
  memoryUsage: () => PlotMemoryUsage;
  /**
   * Return the number of points of the visible traces and how many of them got drawn the last time the plot got drawn.
   * It is not reactive, i.e. it is meant to be polled. Mainly meant for testing and benchmarking.
   */
  pointCounts: () => PlotPointCounts;
  /** Emit the `marginsUpdated` event again (e.g., after the shared margins have been reset). */
  resetMargins: () => void;
}

defineExpose<PlotMethods>({
  contextMenuHidden,
  memoryUsage,
  pointCounts,
  resetMargins
});

const mainDivRef = vue.shallowRef<HTMLElement | null>(null);
const plotDivRef = vue.shallowRef<HTMLElement | null>(null);
const legendRef = vue.shallowRef<HTMLElement | null>(null);
const xAxisTitleRef = vue.shallowRef<HTMLElement | null>(null);
const yAxisTitleRef = vue.shallowRef<HTMLElement | null>(null);
const rangeEditorRef = vue.shallowRef<HTMLElement | null>(null);
const hoverTooltipRef = vue.shallowRef<HTMLElement | null>(null);
const contextMenuRef = vue.ref<InstanceType<typeof ContextMenuWidget> | null>(null);
let plot: uPlot | undefined;
let plotSignature: string | undefined;
let isPlotOutdated = false;
let isUnmounted = false;
let stopTrackingContainerSize: (() => void) | undefined;
let stopTrackingLegendSize: (() => void) | undefined;
let marginsUpdatePending = false;
let trackedMargins: PlotMargins | undefined;

// Whether our axes are logarithmic, which can be changed using our context menu (see contextMenuItems and Logarithmic
// axes below).

const logAxes = vue.ref<Record<AxisKey, boolean>>({ x: false, y: false });

// Whether we use dark mode, i.e. whether our theme is dark or our theme is system and the system uses dark mode.
// Note: we only access window if it exists, so that we can be imported without it (e.g., when rendering on a server).
//       We also keep track of whether the system uses light mode (see onPrefersColorSchemeChange()), but only while we
//       are mounted.

const prefersColorScheme = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;
const systemUsesLightMode = vue.ref<boolean>(prefersColorScheme?.matches ?? true);

const onPrefersColorSchemeChange = (event: MediaQueryListEvent): void => {
  systemUsesLightMode.value = event.matches;
};

const isDarkMode = vue.computed<boolean>(() => {
  return props.theme === 'dark' || (!systemUsesLightMode.value && props.theme !== 'light');
});

// The public CSS variables of our theme (see theme.css) that are set on our ancestors, which our overlays (i.e. our
// hover tooltip and our context menu) get from us, since they may be appended elsewhere (see appendTo) and would
// therefore not inherit them. They are updated whenever an overlay is shown (see updateOverlayThemeStyle()).

const THEME_VARIABLES = [
  '--opencor-plot-background',
  '--opencor-plot-text-color',
  '--opencor-plot-muted-text-color',
  '--opencor-plot-primary-color',
  '--opencor-plot-grid-color',
  '--opencor-plot-zero-line-color',
  '--opencor-plot-hidden-trace-color',
  '--opencor-plot-hover-background',
  '--opencor-plot-overlay-background',
  '--opencor-plot-overlay-border-color',
  '--opencor-plot-overlay-text-color',
  '--opencor-plot-overlay-shadow',
  '--opencor-plot-border-radius',
  '--opencor-plot-focus-ring-width',
  '--opencor-plot-focus-ring-color'
];

const overlayThemeStyle = vue.shallowRef<Record<string, string>>({});

const updateOverlayThemeStyle = (): void => {
  const mainDiv = mainDivRef.value;

  if (!mainDiv) {
    return;
  }

  const computedStyle = getComputedStyle(mainDiv);
  const style: Record<string, string> = {};
  let changed = false;

  for (const variable of THEME_VARIABLES) {
    const value = computedStyle.getPropertyValue(variable);

    if (value) {
      style[variable] = value;
    }

    if (value !== (overlayThemeStyle.value[variable] ?? '')) {
      changed = true;
    }
  }

  if (changed) {
    overlayThemeStyle.value = style;
  }
};

// Our theme colours, which use our theme's CSS variables (see theme.css), so that they can be customised.
// Note: a canvas doesn't understand CSS variables, so we resolve them (see resolvedColor()) for what gets drawn on
//       uPlot's canvas (i.e. our grid lines, zero lines, and tick labels). This is fine since we resolve them whenever
//       our plot gets created (which it does whenever our theme changes, see updatePlot()) or drawn, and our CSS
//       variables get updated as soon as our theme changes (see theme.css). Our exports, however, always use our light
//       colours, whatever our current theme (see exportColors()).

interface ThemeColors {
  background: string;
  text: string;
  tickLabel: string;
  grid: string;
  zeroLine: string;
  zoomFill: string;
  zoomStroke: string;
  hiddenTrace: string;
  hoverGuide: string;
}

const themeColors: ThemeColors = {
  background: 'var(--theme-background)',
  text: 'var(--theme-text-color)',
  tickLabel: 'var(--theme-muted-text-color)',
  grid: 'var(--theme-grid-color)',
  zeroLine: 'var(--theme-zero-line-color)',
  zoomFill: 'color-mix(in srgb, var(--theme-primary-color) 12%, transparent)',
  zoomStroke: 'var(--theme-primary-color)',
  hiddenTrace: 'var(--theme-hidden-trace-color)',
  hoverGuide: 'color-mix(in srgb, var(--theme-muted-text-color) 60%, transparent)'
};

// Resolve the given colour if it is a CSS variable, using our main div since that is where our theme's CSS variables
// are defined (rather than on our document).

const resolvedColor = (color: string): string => {
  return common.cssColor(color, mainDivRef.value ?? document.documentElement);
};

// The theme colours that we draw on uPlot's canvas, which we resolve once per draw (see resolveCanvasColors()) rather
// than every time that we need them, since resolving a colour calls getComputedStyle().

const canvasColors = {
  grid: '',
  zeroLine: '',
  tickLabel: ''
};

const resolveCanvasColors = (): void => {
  // Note: this gets called before our plot gets drawn (see the drawClear hook in createPlot()).

  canvasColors.grid = resolvedColor(themeColors.grid);
  canvasColors.zeroLine = resolvedColor(themeColors.zeroLine);
  canvasColors.tickLabel = resolvedColor(themeColors.tickLabel);
};

// Our traces' visibility, which we keep track of across data updates (e.g., while a simulation is running or when runs
// get tracked in interactive mode).
// Note: a trace is identified by its id, if it has one, or by its name, X and Y values, and run label, if it has them,
//       or by its position otherwise. Several traces may have the same identification (e.g., the same variables for
//       several runs that don't have a run label), so we also identify a trace by its rank among the traces that have
//       the same identification, so that each trace keeps its own visibility.

const traceVisibilityKeys = (traces: PlotTrace[]): string[] => {
  // Return the keys that identify the given traces across data updates.

  const nbOfTracesByKey = new Map<string, number>();

  return traces.map((trace: PlotTrace, index: number) => {
    let key: string;

    if (trace.traceId) {
      key = `id::${trace.traceId}`;
    } else if (trace.name && trace.xValue && trace.yValue) {
      key = `expr::${trace.xValue}::${trace.yValue}::${trace.name}::${trace.runLabel ?? ''}`;
    } else {
      key = `index::${index}`;
    }

    const rank = nbOfTracesByKey.get(key) ?? 0;

    nbOfTracesByKey.set(key, rank + 1);

    return `${key}::${rank}`;
  });
};

const traceVisibilities = vue.shallowRef<boolean[]>([]);

// Trace highlighting through our legend, i.e. hovering a legend item highlights its trace by fading our other traces.
// Note #1: we keep track of the trace which legend item is hovered, so that we can highlight it once it becomes visible
//          (e.g., by clicking on its legend item) and stop highlighting it if it gets hidden or removed (e.g., when
//          runs get tracked in interactive mode, in which case its legend item may be removed without us being told
//          that it is no longer hovered).
// Note #2: this must come before the watcher of our traces (below) since that watcher runs immediately and calls
//          highlightTrace().

let hoveredTrace: number | null = null;
let highlightedTrace: number | null = null;

const seriesAlpha = (index: number): number => {
  // Return the opacity of the given trace, depending on whether a trace is highlighted.

  return highlightedTrace === null || highlightedTrace === index ? 1 : HIGHLIGHT_FADED_ALPHA;
};

const highlightTrace = (index: number | null): void => {
  // Keep track of the trace which legend item is hovered, if any and if it still exists, and highlight it if it is
  // visible, or stop highlighting a trace otherwise.

  hoveredTrace = index !== null && index < props.data.traces.length ? index : null;

  const newHighlightedTrace =
    hoveredTrace !== null && (traceVisibilities.value[hoveredTrace] ?? true) ? hoveredTrace : null;

  if (newHighlightedTrace === highlightedTrace) {
    return;
  }

  highlightedTrace = newHighlightedTrace;

  // Update the opacity of our traces and redraw our plot (without rebuilding the paths of our traces).

  const currentPlot = plot;

  if (!currentPlot) {
    return;
  }

  for (let i = 1; i < currentPlot.series.length; ++i) {
    const plotSeries = currentPlot.series[i];

    if (plotSeries) {
      plotSeries.alpha = seriesAlpha(i - 1);
    }
  }

  currentPlot.redraw(false);
};

const onLegendPointerEnter = (event: PointerEvent, index: number, name: string): void => {
  // Highlight the trace of the given legend item, but only if it is hovered using a mouse or a pen, i.e. not if it is
  // touched since a touch only "hovers" a legend item while it is being touched, so our traces would only flash. Also,
  // show the full name of the trace as a tooltip if it is truncated (see legendMaxWidth).

  if (event.pointerType !== 'touch') {
    highlightTrace(index);
  }

  if (event.currentTarget instanceof HTMLElement) {
    const legendItem = event.currentTarget;

    legendItem.title = legendItem.scrollWidth > legendItem.clientWidth ? plainText(name) : '';
  }
};

const onLegendFocus = (event: FocusEvent, index: number): void => {
  // Highlight the trace of the given legend item, but only if it is focused using the keyboard (as if it was hovered),
  // i.e. not if it is clicked (in which case it is already hovered, or touched, see onLegendPointerEnter()).

  if (event.target instanceof Element && event.target.matches(':focus-visible')) {
    highlightTrace(index);
  }
};

vue.watch(
  () => props.data.traces,
  (traces: PlotTrace[], oldTraces: PlotTrace[] | undefined) => {
    // Keep the visibility of the traces that we already know about and make any new trace visible.

    const previousVisibilityByKey = new Map<string, boolean>();

    traceVisibilityKeys(oldTraces ?? []).forEach((key: string, index: number) => {
      previousVisibilityByKey.set(key, traceVisibilities.value[index] ?? true);
    });

    traceVisibilities.value = traceVisibilityKeys(traces).map(
      (key: string) => previousVisibilityByKey.get(key) ?? true
    );

    // Highlight the trace which legend item is hovered, if any, if it still exists and is visible, or stop highlighting
    // it otherwise (see highlightTrace()).

    highlightTrace(hoveredTrace);
  },
  { immediate: true }
);

// Our legend, which, like Plotly's, is to the right of our plotting area and lets the user toggle the visibility of a
// trace (by clicking on it) or isolate a trace (by double-clicking on it).
// Note: our legend lists our traces by increasing legend rank (and then in the order in which they are given), while
//       our traces are drawn in the order in which they are given.

interface LegendItem {
  index: number;
  color: string;
  name: string;
  visible: boolean;
  markers: boolean;
  dash: number[];
  legendRank: number;
}

const legendItems = vue.computed<LegendItem[]>(() => {
  const visibilities = traceVisibilities.value;

  return props.data.traces
    .map((trace: PlotTrace, index: number) => ({
      index,
      color: trace.color,
      name: trace.name,
      visible: visibilities[index] ?? true,
      markers: hasMarkers(trace.x, trace.y),
      dash: lineDash(trace.lineStyle, LEGEND_DOT_LENGTH),
      legendRank: trace.legendRank ?? DEFAULT_LEGEND_RANK
    }))
    .sort((item1: LegendItem, item2: LegendItem) => item1.legendRank - item2.legendRank || item1.index - item2.index);
});

// Our plotting area, which we use to position our axis titles, axis draggers, zoom box, hover guide line, hover points,
// hover tooltip, and legend.

interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const plotRect = vue.shallowRef<PlotRect | undefined>();

const updatePlotRect = (u: uPlot): void => {
  // Keep track of our plotting area (in CSS pixels, relative to our container).

  const pxRatio = uPlot.pxRatio;
  const newPlotRect = {
    left: u.bbox.left / pxRatio,
    top: u.bbox.top / pxRatio,
    width: u.bbox.width / pxRatio,
    height: u.bbox.height / pxRatio
  };
  const oldPlotRect = plotRect.value;

  if (
    !oldPlotRect ||
    oldPlotRect.left !== newPlotRect.left ||
    oldPlotRect.top !== newPlotRect.top ||
    oldPlotRect.width !== newPlotRect.width ||
    oldPlotRect.height !== newPlotRect.height
  ) {
    plotRect.value = newPlotRect;
  }
};

// The position and width of our legend.
// Note: our legend is at most LEGEND_MAX_WIDTH_RATIO times as wide as our container (with the names of our traces
//       truncated if needed, see onLegendPointerEnter()), so that it doesn't take most of the width of a narrow plot
//       (e.g., with many instances side by side, or with long trace names), and it is hidden altogether if it can't be
//       at least LEGEND_MIN_WIDTH wide. Until we know the width of our container (i.e. until we have been laid out),
//       our legend is neither limited nor hidden, so that it doesn't make our plot get laid out again.

const containerWidth = vue.ref<number>(0);

const legendMaxWidth = vue.computed<number>(() => Math.floor(LEGEND_MAX_WIDTH_RATIO * containerWidth.value));

const legendShown = vue.computed<boolean>(
  () =>
    props.showLegend &&
    legendItems.value.length > 0 &&
    (containerWidth.value === 0 || legendMaxWidth.value >= LEGEND_MIN_WIDTH)
);

const legendLeft = vue.computed<number>(() => {
  // Our legend is to the right of our plotting area, with a small gap in between.

  const rect = plotRect.value;

  return rect ? rect.left + rect.width + LEGEND_LEFT_MARGIN : 0;
});

let legendWidth = 0;

const measureLegendWidth = (): number => {
  // Return the width of our legend, if it is shown.
  // Note: we round up its exact width rather than use its offsetWidth, which is rounded to the nearest integer (and
  //       could therefore be smaller than its exact width, in which case our legend would overflow our container).

  return props.showLegend ? Math.ceil(legendRef.value?.getBoundingClientRect().width ?? 0) : 0;
};

const syncLegendWidth = (): void => {
  // Get our plot to recompute its layout if the width of our legend has changed since our legend is part of our right
  // margin.

  const newLegendWidth = measureLegendWidth();

  if (newLegendWidth !== legendWidth) {
    legendWidth = newLegendWidth;

    relayoutPlot();
  }
};

// Trace visibility handling through our legend.

const setTraceVisibilities = (visibilities: boolean[]): void => {
  // Set the visibility of our traces, both in our legend and in our plot.
  // Note: uPlot autoranges our axes again when the visibility of a trace changes, in which case we animate our axes
  //       that are not zoomed from their current range to their new (natural) range (see animateScales()).

  traceVisibilities.value = visibilities;

  // Highlight the trace which legend item is hovered, if any, if it is now visible, or stop highlighting it if it is
  // now hidden (see highlightTrace()).

  highlightTrace(hoveredTrace);

  // Update the visibility of our traces in our plot, if needed.

  const currentPlot = plot;

  if (!currentPlot) {
    return;
  }

  // Determine the traces which visibility has changed in our plot, if any, and leave if there are none (so that we
  // don't animate our axes for nothing).

  const seriesIndices: number[] = [];

  visibilities.forEach((visible: boolean, index: number) => {
    const plotSeries = currentPlot.series[index + 1];

    if (plotSeries && plotSeries.show !== visible) {
      seriesIndices.push(index + 1);
    }
  });

  if (!seriesIndices.length) {
    return;
  }

  // Keep our axes that are not zoomed at their current range while updating the visibility of our traces (by making
  // them use their current range as their animated range, see scaleRange()), so that we can then animate them to their
  // new range.

  const axisKeys = (['x', 'y'] as AxisKey[]).filter((axisKey: AxisKey) => !zoomRanges[axisKey]);

  for (const axisKey of axisKeys) {
    const range = currentRange(axisKey);

    if (range) {
      animatedRanges[axisKey] = range;
    }
  }

  currentPlot.batch(() => {
    for (const seriesIndex of seriesIndices) {
      currentPlot.setSeries(seriesIndex, {
        show: visibilities[seriesIndex - 1]
      });
    }
  });

  // Animate our axes that are not zoomed to their new range.

  if (axisKeys.length) {
    animateScales(
      Object.fromEntries(axisKeys.map((axisKey: AxisKey) => [axisKey, null])) as Partial<Record<AxisKey, null>>,
      ZOOM_ANIMATION_DURATION
    );
  }
};

interface LegendToggle {
  index: number;
  previousVisibility: boolean;
}

let lastLegendToggle: LegendToggle | undefined;

const onLegendClick = (event: MouseEvent, index: number): void => {
  // Toggle the visibility of the clicked trace, unless this is the second click of a double-click (see
  // onLegendDoubleClick()).

  if (event.detail > 1) {
    return;
  }

  lastLegendToggle = {
    index,
    previousVisibility: traceVisibilities.value[index] ?? true
  };

  setTraceVisibilities(toggledTraceVisibilities(traceVisibilities.value, index));
};

const onLegendDoubleClick = (index: number): void => {
  // Like Plotly, isolate the double-clicked trace (i.e. hide all the other traces) or, if it is already the only
  // visible trace, show all the traces again.
  // Note: the first click of this double-click has already toggled the visibility of the clicked trace (see
  //       onLegendClick()), so we use the visibility that it had before that click. Otherwise, double-clicking the only
  //       visible trace would isolate it again rather than show all the traces again.

  const firstClickToggle = lastLegendToggle?.index === index ? lastLegendToggle : undefined;

  lastLegendToggle = undefined;

  setTraceVisibilities(
    isolatedTraceVisibilities(
      traceVisibilities.value.map((visible: boolean, i: number) =>
        i === index && firstClickToggle ? firstClickToggle.previousVisibility : visible
      ),
      index
    )
  );
};

const onLegendKeyDown = (event: KeyboardEvent, index: number): void => {
  // Show our context menu for the given legend item (so that, for instance, its trace can be isolated using the
  // keyboard) when Shift+F10 (or the context menu key) is pressed.

  if (
    (event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) ||
    event.key === 'ContextMenu'
  ) {
    event.preventDefault();

    showContextMenuUsingKeyboard(event.currentTarget as HTMLElement, index);
  }
};

// Context menu.

// Note #1: when requested from a legend item, our context menu starts with an item to isolate the trace of that legend
//          item (or to show all our traces again), which is also how a trace can be isolated using the keyboard. If
//          there is only one trace, then isolating it makes no sense, so that item shows or hides that trace instead
//          (see legendTraceAction()).
// Note #2: our range editor is opened once our context menu has been hidden (and has given the keyboard focus back), so
//          that it gets (and keeps) the keyboard focus, since it gets closed when it loses it.
// Note #3: we keep track of the trace of the legend item from which our context menu was requested using its key (see
//          traceVisibilityKeys()) rather than its index, since our data may get updated while our context menu is
//          shown, in which case the index of that trace may change (e.g., if a trace that comes before it gets removed)
//          or that trace may get removed, in which case we hide our context menu (rather than remove the item for that
//          trace, which would shift our other items and might result in the wrong item being chosen using the
//          keyboard).

const contextMenuLegendKey = vue.shallowRef<string | null>(null);

const legendKey = (index: number | undefined): string | null => {
  // Return the key of the trace of the given legend item, if any.

  return index === undefined ? null : (traceVisibilityKeys(props.data.traces)[index] ?? null);
};

const legendTraceIndex = (key: string | null): number => {
  // Return the current index of the trace with the given key, or -1 if there is no such trace (anymore).

  return key === null ? -1 : traceVisibilityKeys(props.data.traces).indexOf(key);
};

const contextMenuLegendTraceIndex = vue.computed<number>(() => legendTraceIndex(contextMenuLegendKey.value));

vue.watch(contextMenuLegendTraceIndex, (index: number) => {
  // Hide our context menu if the trace of the legend item from which it was requested has been removed, giving the
  // keyboard focus back to our plot rather than to that legend item, which may now be the legend item of another trace.

  if (index === -1 && contextMenuLegendKey.value !== null) {
    contextMenuFocusTarget = null;

    contextMenuRef.value?.hide();
  }
});

const openRangeEditorLater = (type: AxisEnd): void => {
  window.setTimeout(() => {
    openRangeEditor(type);
  });
};

const legendTraceMenuItem = (key: string, index: number): ContextMenuItem => {
  // Return the item that our context menu starts with when it is requested from the legend item of the trace with the
  // given key, which is currently at the given index.
  // Note: our data may get updated while our context menu is shown (see Note #3). Our context menu then gets our new
  //       items (see ContextMenuWidget's updateLevels()), but a custom context menu keeps the items that it was given,
  //       so the action of our item is determined again when our item is chosen, so that it applies to our trace (if it
  //       still exists) and to the visibility of our traces at that time.

  return {
    icon: 'eye',
    label: legendTraceAction(traceVisibilities.value, props.data.traces.length, index).label,
    command: () => {
      const currentIndex = legendTraceIndex(key);

      if (currentIndex !== -1) {
        setTraceVisibilities(
          legendTraceAction(traceVisibilities.value, props.data.traces.length, currentIndex).visibilities
        );
      }
    }
  };
};

const contextMenuItems = vue.computed<ContextMenuItem[]>(() => [
  ...(contextMenuLegendKey.value === null || contextMenuLegendTraceIndex.value === -1
    ? []
    : [
        legendTraceMenuItem(contextMenuLegendKey.value, contextMenuLegendTraceIndex.value),
        {
          separator: true as const
        }
      ]),
  {
    icon: 'search-plus',
    label: 'Zoom In',
    command: () => zoomIn()
  },
  {
    icon: 'search-minus',
    label: 'Zoom Out',
    command: () => zoomOut()
  },
  {
    icon: 'refresh',
    label: 'Reset Zoom',
    command: () => resetZoom()
  },
  {
    icon: 'pencil',
    label: 'Edit Axis Range',
    items: [
      {
        label: 'X Axis Minimum',
        command: () => openRangeEditorLater('w')
      },
      {
        label: 'X Axis Maximum',
        command: () => openRangeEditorLater('e')
      },
      {
        label: 'Y Axis Minimum',
        command: () => openRangeEditorLater('s')
      },
      {
        label: 'Y Axis Maximum',
        command: () => openRangeEditorLater('n')
      }
    ]
  },
  {
    separator: true
  },
  {
    icon: 'arrows-h',
    label: 'Logarithmic X Axis',
    checked: logAxes.value.x,
    command: () => toggleLogAxis('x')
  },
  {
    icon: 'arrows-v',
    label: 'Logarithmic Y Axis',
    checked: logAxes.value.y,
    command: () => toggleLogAxis('y')
  },
  {
    separator: true
  },
  {
    icon: 'copy',
    label: 'Copy to Clipboard',
    command: () => copyToClipboard()
  },
  {
    icon: 'chart-line',
    label: 'Export Plot',
    items: [
      {
        icon: 'image',
        label: 'JPEG',
        command: () => exportToImage('jpeg')
      },
      {
        icon: 'image',
        label: 'PNG',
        command: () => exportToImage('png')
      },
      {
        icon: 'image',
        label: 'SVG',
        command: () => exportToImage('svg')
      },
      {
        icon: 'image',
        label: 'WebP',
        command: () => exportToImage('webp')
      }
    ]
  },
  {
    separator: true
  },
  {
    label: 'Export Data to CSV',
    icon: 'download',
    command: () => exportToCsv()
  }
]);

let contextMenuShownUsingKeyboard = false;
let contextMenuFocusTarget: HTMLElement | null = null;

const showContextMenu = (event: MouseEvent): void => {
  // Show our context menu or, if we are to use a custom context menu, let people know that it should be shown (see
  // PlotContextMenuEvent).

  if (props.customContextMenu) {
    emit('contextMenu', {
      clientX: event.clientX,
      clientY: event.clientY,
      usingKeyboard: contextMenuShownUsingKeyboard,
      items: contextMenuItems.value
    });
  } else {
    // Note: our context menu items may just have changed (e.g., if our context menu is requested from a legend item,
    //       see contextMenuItems), so we wait for our context menu to have been updated before showing it.

    const usingKeyboard = contextMenuShownUsingKeyboard;

    updateOverlayThemeStyle();

    void vue.nextTick().then(() => contextMenuRef.value?.show(event, usingKeyboard));
  }
};

const onContextMenu = (event: MouseEvent): void => {
  // Leave a context menu that is requested from our range editor to the browser (e.g., to copy/paste some text), so
  // that our range editor doesn't get closed by our context menu taking the keyboard focus away from it.
  // Note: this also happens when our range editor gets opened using a tap, in which case it is opened under the finger,
  //       with its text selected, so the tap is then considered as being on selected text, which gets a mobile browser
  //       to show its text selection menu (and therefore to request a context menu).

  if (event.target instanceof Node && rangeEditorRef.value?.contains(event.target)) {
    return;
  }

  // Prevent the default context menu from being shown.

  event.preventDefault();

  // Hide our hover tooltip, if any, so that it doesn't get in the way of our context menu.

  hover.value = null;

  contextMenuShownUsingKeyboard = false;

  // Keep track of whether our context menu was requested from a legend item (see contextMenuItems), and of where the
  // keyboard focus should go once our context menu has been hidden (see onContextMenuHide()).

  const legendItemElement =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-legend-index]') : null;

  contextMenuLegendKey.value = legendKey(legendItemElement ? Number(legendItemElement.dataset.legendIndex) : undefined);
  contextMenuFocusTarget = legendItemElement;

  // Keep track of where our context menu was requested, so that we can zoom in/out around that position (see zoomIn()
  // and zoomOut()).
  // Note: we only consider the position along an axis if it is within our plotting area along that axis (e.g., not if
  //       our context menu was requested on our Y axis, in which case we use the middle of our X axis).

  const rect = plotRect.value;

  contextMenuCenterFractions = {};

  if (rect) {
    const position = plotPosition(event, rect);
    const xFraction = position.x / rect.width;
    const yFraction = (rect.height - position.y) / rect.height;

    if (xFraction >= 0 && xFraction <= 1) {
      contextMenuCenterFractions.x = xFraction;
    }

    if (yFraction >= 0 && yFraction <= 1) {
      contextMenuCenterFractions.y = yFraction;
    }
  }

  // Show our context menu.

  showContextMenu(event);
};

const showContextMenuUsingKeyboard = (legendItemElement?: HTMLElement, legendIndex?: number): void => {
  // Make sure that our plot has been laid out.

  const rect = plotRect.value;
  const mainDivRect = mainDivRef.value?.getBoundingClientRect();

  if (!rect || !mainDivRect) {
    return;
  }

  // Show our context menu at the centre of our plotting area (which is also where we zoom in/out, see zoomIn() and
  // zoomOut()) or, if it is for a legend item, at the centre of that legend item, and keep track of the fact that it
  // was shown using the keyboard (see onContextMenuHide()).
  // Note: our context menu gets the keyboard focus when it is shown, so that it can be used with the keyboard straight
  //       away.

  const legendItemRect = legendItemElement?.getBoundingClientRect();

  hover.value = null;
  contextMenuCenterFractions = {};
  contextMenuShownUsingKeyboard = true;
  contextMenuLegendKey.value = legendKey(legendIndex);
  contextMenuFocusTarget = legendItemElement ?? null;

  showContextMenu(
    new MouseEvent('contextmenu', {
      clientX: legendItemRect
        ? legendItemRect.left + 0.5 * legendItemRect.width
        : mainDivRect.left + rect.left + 0.5 * rect.width,
      clientY: legendItemRect
        ? legendItemRect.top + 0.5 * legendItemRect.height
        : mainDivRect.top + rect.top + 0.5 * rect.height
    })
  );
};

const onContextMenuHide = (): void => {
  // Give the keyboard focus back to our plot (or to the legend item from which our context menu was requested, see
  // contextMenuFocusTarget), whether our context menu was shown using the keyboard or the mouse (since it takes the
  // keyboard focus in both cases, e.g., so that it can be hidden using Escape), unless the keyboard focus has gone
  // somewhere else in the meantime (i.e. somewhere else than <body> or our context menu, which may keep the keyboard
  // focus while it is being hidden).

  const focusTarget = contextMenuFocusTarget;

  contextMenuShownUsingKeyboard = false;
  contextMenuFocusTarget = null;

  void vue.nextTick().then(() => {
    const activeElement = document.activeElement;

    if (
      !isUnmounted &&
      (!activeElement || activeElement === document.body || activeElement.closest('.opencor-context-menu'))
    ) {
      (focusTarget?.isConnected ? focusTarget : plotDivRef.value)?.focus();
    }
  });
};

// Copy and export, like Plotly, i.e. an image of our plot and of our legend (but not of what we show when hovering or
// zooming, i.e. our hover tooltip, guide line, and highlighted points, and our zoom box).
// Note: we build an SVG document from what we currently show, which we either export as is or rasterise. For our axis
//       titles and legend, we use where the browser renders their text, so that any HTML they contain (e.g., subscripts
//       and superscripts) gets rendered as it is in our panel.

type ImageFormat = PlotImageExportEvent['format'];
type RasterImageFormat = Exclude<ImageFormat, 'svg'>;

interface SvgPath extends Path {
  data: string[];
}

interface SvgDocument {
  svg: Blob;
  width: number;
  height: number;
}

const svgNumber = (value: number): string => {
  // Return the given number with at most two decimals, which is more than precise enough for an SVG document.
  // Note: we divide by 100 rather than multiply by 0.01 since the latter would introduce some floating point errors
  //       (e.g., 0.01 * 57 is 0.5700000000000001 while 57 / 100 is 0.57).

  return String(Math.round(100 * value) / 100);
};

const escapeXml = (text: string): string => {
  // Escape the given text, so that it can be used in an SVG document (as some text or as the value of an attribute).

  return text.replace(/[&<>"']/g, (character: string) => `&#${character.charCodeAt(0)};`);
};

const svgPath = (): SvgPath => {
  // Return a path that builds some SVG path data.

  const data: string[] = [];

  return {
    data,
    moveTo: (x: number, y: number) => {
      data.push(`M${svgNumber(x)} ${svgNumber(y)}`);
    },
    lineTo: (x: number, y: number) => {
      data.push(`L${svgNumber(x)} ${svgNumber(y)}`);
    },
    arc: (x: number, y: number, radius: number) => {
      // Note: we only ever draw full circles from their rightmost point (see markerPath()), so we draw two half
      //       circles.

      const r = svgNumber(radius);

      data.push(
        `A${r} ${r} 0 1 0 ${svgNumber(x - radius)} ${svgNumber(y)}A${r} ${r} 0 1 0 ${svgNumber(x + radius)} ${svgNumber(y)}`
      );
    }
  };
};

const svgPathElement = (path: SvgPath, attributes: string): string => {
  // Return an SVG path element for the given path, if it isn't empty.

  return path.data.length ? `<path d="${path.data.join('')}" ${attributes}/>` : '';
};

const svgHtmlText = (element: HTMLElement | null, origin: DOMRect, vertical: boolean, color: string): string => {
  // Return the text of the given (rendered) element as SVG text elements (one per text node), positioned relative to
  // the given origin, using the given colour (see exportColors()).
  // Note: the client rectangle of a text node is the content area of its font, i.e. its alphabetic baseline is the
  //       font's ascent below its top. However, if our text is vertical (i.e. our Y axis title, which reads from bottom
  //       to top), then its baseline is the font's ascent to the right of its left.

  // Make sure that we have a valid element.

  if (!element) {
    return '';
  }

  // Walk the text nodes of our element and add an SVG text element for each one that has some rendered text.

  const res: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Make sure that our text node has some text (other than whitespace) and that it is rendered.
    // Note: we only consider the whitespace that the browser collapses (i.e. not non-breaking spaces).

    const text = node.textContent ?? '';
    const start = text.search(/[^ \t\n\r\f]/);
    const end = text.search(/[ \t\n\r\f]*$/);
    const parent = node.parentElement;

    if (start === -1 || !parent) {
      continue;
    }

    // Get the client rectangle of our text node and skip it if it has no width or height (e.g., if it is hidden).

    range.setStart(node, start);
    range.setEnd(node, end);

    const rect = range.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      continue;
    }

    // Determine the decorations of our text, which, unlike its other styles, are not inherited, so we must also look at
    // the ancestors of our text node.

    const style = getComputedStyle(parent);
    const decorations = new Set<string>();

    for (let ancestor: HTMLElement | null = parent; ancestor; ancestor = ancestor.parentElement) {
      for (const decoration of getComputedStyle(ancestor).textDecorationLine.split(' ')) {
        if (decoration !== 'none') {
          decorations.add(decoration);
        }
      }

      if (ancestor === element) {
        break;
      }
    }

    // Add an SVG text element for our text node.

    const ascent = fontAscent(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`);
    const x = vertical ? rect.left - origin.left + ascent : rect.left - origin.left;
    const y = vertical ? rect.bottom - origin.top : rect.top - origin.top + ascent;

    res.push(
      `<text ${vertical ? `transform="translate(${svgNumber(x)} ${svgNumber(y)}) rotate(-90)"` : `x="${svgNumber(x)}" y="${svgNumber(y)}"`}` +
        ` font-family="${escapeXml(style.fontFamily)}" font-size="${style.fontSize}" font-style="${style.fontStyle}"` +
        ` font-weight="${style.fontWeight}" fill="${escapeXml(color)}"` +
        (decorations.size ? ` text-decoration="${[...decorations].join(' ')}"` : '') +
        `>${escapeXml(text.slice(start, end).replace(/[ \t\n\r\f]+/g, ' '))}</text>`
    );
  }

  // Return our SVG text elements.

  return res.join('');
};

const svgLegend = (origin: DOMRect, scale: number, colors: ExportColors): string => {
  // Return our legend, if it is shown, as an SVG group, clipped to what can currently be seen of it (e.g., if it is
  // scrollable).

  // Make sure that we have a legend to export.

  const legend = legendRef.value;

  if (!props.showLegend || !legend) {
    return '';
  }

  // Clip our legend to its client area, i.e. to what can currently be seen of it.

  const legendRect = legend.getBoundingClientRect();
  const res: string[] = [
    `<clipPath id="legend"><rect x="${svgNumber(legendRect.left - origin.left + legend.clientLeft)}" y="${svgNumber(legendRect.top - origin.top + legend.clientTop)}" width="${legend.clientWidth}" height="${legend.clientHeight}"/></clipPath>`,
    '<g clip-path="url(#legend)">'
  ];

  // Like the browser, we snap the swatch and marker of our legend items to whole (scaled) pixels, so that they are
  // crisp and where the browser renders them.

  const snap = (value: number): number => Math.round(scale * value) / scale;

  Array.from(legend.children).forEach((legendItemElement: Element, index: number) => {
    // Make sure that we have a legend item to export.

    const legendItem = legendItems.value[index];

    if (!legendItem) {
      return;
    }

    const opacity = getComputedStyle(legendItemElement).opacity;

    res.push(opacity === '1' ? '<g>' : `<g opacity="${escapeXml(opacity)}">`);

    // Add the swatch of our legend item, if it has one.

    // Note: the colour of our swatch (and of its marker) is that of our trace, or our hidden trace colour (in our
    //       export colours) if our trace is hidden.

    const swatchColor = legendItem.visible ? legendItem.color : colors.hiddenTrace;
    const swatchElement = legendItemElement.querySelector('.legend-swatch');
    const swatch = swatchElement?.getBoundingClientRect();
    const swatchStyle = swatchElement ? getComputedStyle(swatchElement) : undefined;

    if (swatch && swatchStyle) {
      const swatchLeft = snap(swatch.left - origin.left);
      const swatchTop = snap(swatch.top - origin.top);
      const swatchWidth = snap(swatch.right - origin.left) - swatchLeft;
      const swatchHeight = snap(swatch.bottom - origin.top) - swatchTop;

      // Note: a dashed swatch is drawn as a line with the dash pattern of our legend item, which is what its gradient
      //       draws (see our template).

      if (legendItem.dash.length) {
        const swatchMiddle = swatchTop + 0.5 * swatchHeight;

        res.push(
          `<line x1="${svgNumber(swatchLeft)}" y1="${svgNumber(swatchMiddle)}" x2="${svgNumber(swatchLeft + swatchWidth)}" y2="${svgNumber(swatchMiddle)}" stroke="${escapeXml(swatchColor)}" stroke-width="${svgNumber(swatchHeight)}" stroke-dasharray="${legendItem.dash.map(svgNumber).join(' ')}"/>`
        );
      } else {
        res.push(
          `<rect x="${svgNumber(swatchLeft)}" y="${svgNumber(swatchTop)}" width="${svgNumber(swatchWidth)}" height="${svgNumber(swatchHeight)}" rx="${svgNumber(Number.parseFloat(swatchStyle.borderRadius) || 0)}" fill="${escapeXml(swatchColor)}"/>`
        );
      }
    }

    // Add the marker of our legend item, if it has one.

    const markerElement = legendItemElement.querySelector('.legend-marker');
    const marker = markerElement?.getBoundingClientRect();

    if (markerElement && marker) {
      const markerLeft = snap(marker.left - origin.left);
      const markerTop = snap(marker.top - origin.top);
      const markerRight = snap(marker.right - origin.left);
      const markerBottom = snap(marker.bottom - origin.top);

      res.push(
        `<circle cx="${svgNumber(0.5 * (markerLeft + markerRight))}" cy="${svgNumber(0.5 * (markerTop + markerBottom))}" r="${svgNumber(0.5 * (markerRight - markerLeft))}" fill="${escapeXml(swatchColor)}"/>`
      );
    }

    // Add the text of our legend item, which is the last child of our legend item element.

    res.push(svgHtmlText(legendItemElement.lastElementChild as HTMLElement | null, origin, false, colors.text), '</g>');
  });

  res.push('</g>');

  // Return our legend as an SVG group.

  return res.join('');
};

// The colours of our exports, which are those of our light theme (whatever our current theme), since an exported image
// is typically used in a document (e.g., a paper or some slides) that is light. They are our default light colours,
// i.e. they ignore our public CSS variables, since those may customise our current theme (e.g., our dark theme).
// Note: we resolve our colours using a temporary element, which has our (light) theme and resets our public CSS
//       variables, so that our default colours get used (see theme.css).

interface ExportColors {
  background: string;
  text: string;
  tickLabel: string;
  grid: string;
  zeroLine: string;
  hiddenTrace: string;
}

const exportColors = (): ExportColors => {
  const element = document.createElement('div');

  element.className = 'opencor-plot-theme';
  element.style.display = 'none';

  for (const variable of THEME_VARIABLES) {
    element.style.setProperty(variable, 'initial');
  }

  document.body.append(element);

  try {
    const color = (themeColor: string): string => common.cssColor(themeColor, element);

    return {
      background: color(themeColors.background),
      text: color(themeColors.text),
      tickLabel: color(themeColors.tickLabel),
      grid: color(themeColors.grid),
      zeroLine: color(themeColors.zeroLine),
      hiddenTrace: color(themeColors.hiddenTrace)
    };
  } finally {
    element.remove();
  }
};

const svgDocument = (scale: number = 1): SvgDocument => {
  // Return our SVG document, which is the size of our container times the given scale.

  // Make sure that we have a plot to export.

  const mainDiv = mainDivRef.value;
  const u = plot;
  const canvasArea = u ? pathArea(u) : undefined;

  if (!mainDiv || !u || !canvasArea) {
    throw new Error('There is no plot to export.');
  }

  // Our plotting area and the ranges of our axes, in scaled pixels (i.e. in CSS pixels times the given scale).
  // Note: we draw our plot in scaled pixels (and the rest in CSS pixels, scaled using a transform), so that if the
  //       given scale is our device pixel ratio, our grid lines, traces, and markers are drawn exactly as uPlot draws
  //       them (e.g., our grid lines are aligned to the same pixels).

  const factor = scale / canvasArea.pxRatio;
  const area: PathArea = {
    ...canvasArea,
    left: factor * canvasArea.left,
    top: factor * canvasArea.top,
    width: factor * canvasArea.width,
    height: factor * canvasArea.height,
    pxRatio: scale
  };
  const { left, top, width, height } = area;
  const origin = mainDiv.getBoundingClientRect();
  const scaledWidth = Math.round(scale * mainDiv.clientWidth);
  const scaledHeight = Math.round(scale * mainDiv.clientHeight);
  const colors = exportColors();
  const res: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scaledWidth}" height="${scaledHeight}" viewBox="0 0 ${scaledWidth} ${scaledHeight}">`,
    `<clipPath id="markers"><rect x="${svgNumber(left)}" y="${svgNumber(top)}" width="${svgNumber(width)}" height="${svgNumber(height)}"/></clipPath>`,
    `<rect width="${scaledWidth}" height="${scaledHeight}" fill="${escapeXml(colors.background)}"/>`
  ];

  // Our grid lines and zero lines, which get drawn in that order on uPlot's canvas (see drawZeroLines()).
  // Note: uPlot draws all our grid lines, including one that is at the right (or bottom) edge of our plotting area,
  //       i.e. that is just outside of it once aligned (if our line width is an odd number of pixels).

  const [xAxis, yAxis] = u.axes as unknown as AxisInternals[];
  const xSplits = xAxis?._splits ?? [];
  const ySplits = yAxis?._splits ?? [];

  const lines = (color: string, xValues: number[], yValues: number[], withinPlottingArea?: boolean): string => {
    const path = svgPath();

    linesPath(path, xValues, yValues, area, withinPlottingArea);

    return svgPathElement(path, `stroke="${escapeXml(color)}" stroke-width="${lineWidth(scale)}" fill="none"`);
  };

  res.push(lines(colors.grid, xSplits, ySplits, false), lines(colors.zeroLine, zeroLines('x'), zeroLines('y')));

  // Our visible traces and their markers, if any, which uPlot draws in that order, trace by trace.
  // Note: like uPlot, we clip a trace to our plotting area, give or take half its line width, so we have a clip path
  //       for each line width of our traces.

  const traceClipPaths = new Map<number, string>();

  const traceClipPath = (traceLineWidth: number): string => {
    // Return the identifier of the clip path of a trace with the given line width (in scaled pixels), after adding that
    // clip path to our document, if needed.

    let id = traceClipPaths.get(traceLineWidth);

    if (id === undefined) {
      id = `traces-${traceClipPaths.size + 1}`;

      traceClipPaths.set(traceLineWidth, id);

      res.push(
        `<clipPath id="${id}"><rect x="${svgNumber(left - 0.5 * traceLineWidth)}" y="${svgNumber(top - 0.5 * traceLineWidth)}" width="${svgNumber(width + traceLineWidth)}" height="${svgNumber(height + traceLineWidth)}"/></clipPath>`
      );
    }

    return id;
  };

  for (let seriesIndex = 1; seriesIndex < u.series.length; ++seriesIndex) {
    const [xValues, yValues] = seriesData(u, seriesIndex) ?? [];
    const color = props.data.traces[seriesIndex - 1]?.color;

    if (!u.series[seriesIndex]?.show || !xValues || !yValues || !color) {
      continue;
    }

    const tracePath = createChunkedPath(svgPath);
    const traceLineWidth = seriesLineWidth(seriesIndex) * scale;
    const traceLineDash = seriesLineDash(seriesIndex).map((length: number) => svgNumber(length * scale));
    const traceAttributes =
      `stroke="${escapeXml(color)}" stroke-width="${svgNumber(traceLineWidth)}"` +
      (traceLineDash.length ? ` stroke-dasharray="${traceLineDash.join(' ')}"` : '') +
      ` stroke-linejoin="round" fill="none" clip-path="url(#${traceClipPath(traceLineWidth)})"`;

    // Note: we don't simplify our trace, so that it is exactly what we would draw without our level of detail, but we
    //       still use a SimplifiedPath (see Note #4 of simplifiedPathUtils.ts).

    const simplifiedPath = new SimplifiedPath(tracePath, 0);

    linearPath(
      simplifiedPath,
      xValues,
      yValues,
      0,
      Math.min(xValues.length, yValues.length) - 1,
      area,
      seriesLineWidth(seriesIndex)
    );

    simplifiedPath.end();

    for (const path of tracePath.paths) {
      res.push(svgPathElement(path, traceAttributes));
    }

    if (hasMarkers(xValues, yValues)) {
      const markersPath = svgPath();

      markerPath(markersPath, xValues, yValues, area);

      res.push(svgPathElement(markersPath, `fill="${escapeXml(color)}" clip-path="url(#markers)"`));
    }
  }

  // The rest of our document is in CSS pixels.

  res.push(`<g transform="scale(${scale})">`);

  // Our tick labels (see tickLabels()).

  const svgTickLabels = tickLabels(u, area).map(
    (tickLabel: TickLabel) =>
      `<text x="${svgNumber(tickLabel.x / scale)}" y="${svgNumber(tickLabel.y / scale)}" text-anchor="${tickLabel.align === 'center' ? 'middle' : 'end'}">${escapeXml(tickLabel.text)}</text>`
  );

  res.push(
    `<g font-family="${escapeXml(fontFamily)}" font-size="${TICK_FONT_SIZE}" fill="${escapeXml(colors.tickLabel)}">${svgTickLabels.join('')}</g>`
  );

  // Our axis titles and legend, which we render on top of our plot.

  res.push(
    svgHtmlText(xAxisTitleRef.value, origin, false, colors.text),
    svgHtmlText(yAxisTitleRef.value, origin, true, colors.text),
    svgLegend(origin, scale, colors),
    '</g></svg>'
  );

  // Return our SVG document and its size in scaled pixels.
  // Note: our SVG document is a blob of its parts rather than one string, since it can be longer than a string can be
  //       (e.g., about 536,000,000 characters in Chrome) if our traces have many points.

  return {
    svg: new Blob(res, { type: 'image/svg+xml' }),
    width: scaledWidth,
    height: scaledHeight
  };
};

const rasterImage = async (format: RasterImageFormat): Promise<Blob> => {
  // Rasterise our SVG document at our device pixel ratio, so that our image is as sharp as our plot (unlike Plotly,
  // which rasterises its SVG document at the size of its container).

  const { svg, width, height } = svgDocument(uPlot.pxRatio);
  const url = URL.createObjectURL(svg);

  try {
    // Load our SVG document as an image and wait for it to be decoded.

    const image = new Image();

    image.src = url;

    await image.decode();

    // Draw our image on a canvas, so that we can get it in the given format.

    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to create a canvas context.');
    }

    context.drawImage(image, 0, 0, width, height);

    // Get our image in the given format.
    // Note: a browser falls back to PNG if it can't encode an image in the given format (e.g., WebP in Safari).

    const type = `image/${format}`;
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type);
    });

    if (blob?.type !== type) {
      throw new Error(`Failed to generate a ${format.toUpperCase()} image.`);
    }

    // Return our image as a blob.

    return blob;
  } finally {
    // Revoke the URL that we created for our SVG document, so that it can be garbage collected.

    URL.revokeObjectURL(url);
  }
};

const copyToClipboard = (): void => {
  // Copy our plot to the clipboard as a PNG image, and let people know whether it worked (see PlotImageExportEvent).
  // Note #1: we give ClipboardItem a promise (rather than a blob) since Safari requires navigator.clipboard.write() to
  //          be called straight away, i.e. while handling the user's action.
  // Note #2: navigator.clipboard and ClipboardItem may not be available (e.g., in an insecure context), in which case
  //          an error gets thrown straight away, hence our try...catch.

  const failed = (error: unknown): void => {
    console.warn('@opencor/plot: failed to copy to clipboard:', common.formatError(error));

    emit('imageExport', { action: 'copy', format: 'png', success: false });
  };

  try {
    navigator.clipboard
      .write([
        new ClipboardItem({
          'image/png': rasterImage('png')
        })
      ])
      .then(() => {
        emit('imageExport', { action: 'copy', format: 'png', success: true });
      })
      .catch(failed);
  } catch (error: unknown) {
    failed(error);
  }
};

const exportToImage = async (format: ImageFormat): Promise<void> => {
  // Export our plot to an image in the given format, and let people know whether it worked (see PlotImageExportEvent).

  try {
    if (format === 'svg') {
      common.downloadFile('plot.svg', svgDocument().svg, 'image/svg+xml');
    } else {
      common.downloadFile(`plot.${format}`, await rasterImage(format), `image/${format}`);
    }

    emit('imageExport', { action: 'export', format, success: true });
  } catch (error: unknown) {
    console.warn('@opencor/plot: failed to export image:', common.formatError(error));

    emit('imageExport', { action: 'export', format, success: false });
  }
};

// Some helpers for our export to CSV.
// Note: a CSV field must be quoted if it contains a comma, a double quote, or a line break, in which case any double
//       quote must be doubled (see RFC 4180).

const sameValues = (values1: Float64Array, values2: Float64Array): boolean => {
  if (values1 === values2) {
    return true;
  }

  if (values1.length !== values2.length) {
    return false;
  }

  for (let i = 0; i < values1.length; ++i) {
    if (!Object.is(values1[i], values2[i])) {
      return false;
    }
  }

  return true;
};

const csvField = (field: string): string => {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
};

const csvValue = (value: number | undefined): string => {
  return value !== undefined ? String(value) : '';
};

const exportToCsv = async (): Promise<void> => {
  // Make sure that we have at least one trace to export.

  const firstTrace = props.data.traces[0];

  if (!firstTrace) {
    return;
  }

  // Let people know that we have started exporting to CSV.

  emit('csvExport', { type: 'started' });

  let successfulExport: boolean = true;

  try {
    // Allow the UI to update (e.g., to show some progress) before actually starting the export to CSV.

    await common.waitForNextPaint();

    // Perform the export itself.
    // Note: to efficiently export to CSV, we build an array of CSV lines, which we join together for each chunk of rows
    //       (see below), rather than concatenate strings together repeatedly. Each chunk is then turned into a blob and
    //       our CSV file is a blob of those blobs. Indeed, our CSV file may be much bigger than the maximum length of a
    //       string (e.g., about 800 MB for three traces with 10 million points, while the maximum length of a string is
    //       about 512 MB in Chrome), and a blob may be kept outside of the JavaScript heap.

    const csvType = 'text/csv;charset=utf-8;';
    const csvChunks: Blob[] = [];
    let csvLines: string[] = [];

    const addCsvChunk = (): void => {
      csvChunks.push(new Blob([`${csvLines.join('\r\n')}\r\n`], { type: csvType }));

      csvLines = [];
    };

    // Group our traces by X values, so that traces that share the same X values (e.g., the traces of a given run) also
    // share the same X column, while traces that don't (e.g., the traces of different runs, or a phase plot and a time
    // plot) get their own X column. Our columns are therefore X1, Y1a, Y1b, ..., X2, Y2a, ...
    // Note #1: we keep our X and Y values in the order in which they are plotted (rather than, say, sort them by X
    //          value), so that a phase plot (where X values may go up and down) or repeated X values are exported as
    //          they are.
    // Note #2: we export our traces in the order in which they are listed in our legend (e.g., the live run first),
    //          rather than in the order in which they are drawn (e.g., the live run last, so that it is drawn on top of
    //          the other runs).

    const groups: { trace: PlotTrace; traces: PlotTrace[] }[] = [];

    for (const legendItem of legendItems.value) {
      const trace = props.data.traces[legendItem.index];

      if (!trace) {
        continue;
      }

      const group = groups.find((group) => sameValues(group.trace.x, trace.x));

      if (group) {
        group.traces.push(trace);
      } else {
        groups.push({ trace, traces: [trace] });
      }
    }

    // Headers.
    // Note #1: we only keep the text of a trace name (e.g., "<i>I<sub>K,r</sub></i>" becomes "IK,r").
    // Note #2: different X columns may be for the same X value (e.g., x for the y vs. x traces of two runs), in which
    //          case we add the run label of their traces, if they all have the same one, to their header (e.g., "x
    //          [Live]" and "x [#1]"), so that they can be told apart.

    const headerParts: string[] = [];

    for (const group of groups) {
      const runLabel = group.trace.runLabel;
      const ambiguousXValue = groups.some(
        (otherGroup) => otherGroup !== group && otherGroup.trace.xValue === group.trace.xValue
      );
      const xHeader =
        ambiguousXValue && runLabel && group.traces.every((trace) => trace.runLabel === runLabel)
          ? `${group.trace.xValue} [${runLabel}]`
          : group.trace.xValue;

      headerParts.push(csvField(xHeader));

      for (const trace of group.traces) {
        headerParts.push(csvField(plainText(trace.name) || trace.yValue));
      }
    }

    csvLines.push(headerParts.join(','));

    // Data rows, of which there are as many as the number of values of our longest X column, with empty cells for the X
    // columns (and their Y columns) that have fewer values.
    // Note: we let people know about our progress and keep the UI responsive every CSV_EXPORT_YIELD_INTERVAL
    //       milliseconds, rather than after a given number of rows. Indeed, a browser makes us wait at least 4 ms when
    //       we yield to it many times in a row, so yielding after every chunk of rows (i.e. 100 times) would make an
    //       export take at least about 0.4 s, even for a few rows.

    const nbOfRows = Math.max(...groups.map((group) => group.trace.x.length));
    const chunkSize = Math.max(1, Math.floor(0.01 * nbOfRows));
    const percentPerRow = 100 / nbOfRows;
    let lastYieldTime = performance.now();

    for (let row = 0; row < nbOfRows; ++row) {
      const rowParts: string[] = [];

      for (const group of groups) {
        rowParts.push(csvValue(group.trace.x[row]));

        for (const trace of group.traces) {
          rowParts.push(csvValue(trace.y[row]));
        }
      }

      csvLines.push(rowParts.join(','));

      if ((row + 1) % chunkSize === 0 || row + 1 === nbOfRows) {
        addCsvChunk();

        if (performance.now() - lastYieldTime >= CSV_EXPORT_YIELD_INTERVAL) {
          emit('csvExport', { type: 'progress', percent: Math.floor(percentPerRow * (row + 1)) });

          await common.sleep(common.NO_DELAY);

          lastYieldTime = performance.now();

          // Stop exporting if we got unmounted in the meantime (e.g., if our plot got closed).

          if (isUnmounted) {
            successfulExport = false;

            return;
          }
        }
      }
    }

    // Make sure that we report 100% before finishing.

    emit('csvExport', { type: 'progress', percent: 100 });

    // Create and download the CSV file, making sure that we have added our last lines (e.g., our headers if we have no
    // rows).

    if (csvLines.length) {
      addCsvChunk();
    }

    common.downloadFile('data.csv', new Blob(csvChunks, { type: csvType }), csvType);
  } catch (error: unknown) {
    successfulExport = false;

    console.warn('@opencor/plot: failed to export to CSV:', common.formatError(error));
  } finally {
    // Let people know that we have finished exporting to CSV, successfully or not.
    // Note: it is up to them to decide how to handle this (e.g., if they show some progress, then they may want to
    //       delay hiding it so that people can see that we reached 100%).

    emit('csvExport', { type: 'finished', success: successfulExport });
  }
};

// Plotting.
// Note: we use uPlot's mode 2, i.e. each trace has its own X and Y values, which means that we can plot both time
//       series and phase plots.

type AxisKey = 'x' | 'y';

const seriesData = (u: uPlot, seriesIndex: number): [Float64Array, Float64Array] | undefined => {
  // Return the X and Y values of the given series.

  return (u.data as unknown as [null, ...[Float64Array, Float64Array][]])[seriesIndex] ?? undefined;
};

const seriesColor = (seriesIndex: number): string => {
  // Return the colour of the given series, i.e. that of its trace.

  return props.data.traces[seriesIndex - 1]?.color ?? 'transparent';
};

const seriesLineWidth = (seriesIndex: number): number => {
  // Return the line width (in CSS pixels) of the given series, i.e. that of its trace, if it is valid, or our default
  // line width otherwise.

  return validLineWidth(props.data.traces[seriesIndex - 1]?.lineWidth, LINE_WIDTH);
};

const seriesLineDash = (seriesIndex: number): number[] => {
  // Return the dash pattern (in CSS pixels) of the given series, i.e. that of the line style of its trace, scaled with
  // its line width.

  return lineDash(props.data.traces[seriesIndex - 1]?.lineStyle, dotLength(seriesLineWidth(seriesIndex)));
};

const hasMarkers = (xValues?: Float64Array, yValues?: Float64Array): boolean => {
  // Like Plotly, a trace with fewer than 20 points also has markers.

  const nbOfPoints = xValues && yValues ? Math.min(xValues.length, yValues.length) : 0;

  return nbOfPoints > 0 && nbOfPoints < MIN_NB_OF_POINTS_WITHOUT_MARKERS;
};

const seriesHasMarkers = (u: uPlot, seriesIndex: number): boolean => {
  // Return whether the given series has markers.

  const [xValues, yValues] = seriesData(u, seriesIndex) ?? [];

  return hasMarkers(xValues, yValues);
};

const anyMarkers = (u: uPlot): boolean => {
  // Return whether any of our visible traces has markers.

  for (let i = 1; i < u.series.length; ++i) {
    if (u.series[i]?.show && seriesHasMarkers(u, i)) {
      return true;
    }
  }

  return false;
};

const finiteDataRange = (u: uPlot, axisKey: AxisKey, seriesIndex?: number): Range | undefined => {
  // Determine the range of the (finite) values of our visible traces (or of the given trace) for the given axis, using
  // the statistics of their values (see plotValues()).

  const firstIndex = seriesIndex ?? 1;
  const lastIndex = seriesIndex ?? u.series.length - 1;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = firstIndex; i <= lastIndex; ++i) {
    const statistics = plottedValues[i - 1]?.[axisKey].statistics;

    if (!statistics || !u.series[i]?.show) {
      continue;
    }

    min = Math.min(min, statistics.min);
    max = Math.max(max, statistics.max);
  }

  return min <= max ? [min, max] : undefined;
};

interface Extremum {
  value: number;
  padding: number; // In CSS pixels.
}

const autoRange = (u: uPlot, axisKey: AxisKey, min: number, max: number): Range => {
  // Autorange the given axis like Plotly, i.e. our X axis is tight while our Y axis is padded by 5% of its length on
  // both ends, and the points of a trace with markers are padded by 5% of the length of both axes plus some padding for
  // the markers themselves. This means that we have a minimum and a maximum extremum for our traces and for each trace
  // with markers, each extremum with its own padding. The range that we want is the one that fits all of those extrema,
  // i.e. the one that needs the most value per pixel.
  // Note: the minimum and maximum extrema of a trace with markers are also within the range of our traces, but they get
  //       padded more, so we consider them separately.

  // Make sure that our range is not zero-width since uPlot can't handle it.

  if (min === max) {
    return [min - 1, max + 1];
  }

  // Determine the extrema of our traces and of our traces with markers, each with its own padding.

  const length = (axisKey === 'x' ? u.bbox.width : u.bbox.height) / uPlot.pxRatio;
  const padding = axisKey === 'y' ? AUTORANGE_PADDING * length : 0;
  const markersPadding = AUTORANGE_PADDING * length + MARKER_PADDING;
  const minExtrema: Extremum[] = [{ value: min, padding }];
  const maxExtrema: Extremum[] = [{ value: max, padding }];

  for (let i = 1; i < u.series.length; ++i) {
    if (u.series[i]?.show && seriesHasMarkers(u, i)) {
      const traceRange = finiteDataRange(u, axisKey, i);

      if (traceRange) {
        minExtrema.push({ value: traceRange[0], padding: markersPadding });
        maxExtrema.push({ value: traceRange[1], padding: markersPadding });
      }
    }
  }

  // Determine the range that fits all of our extrema, falling back to a tight range if there is not enough room for our
  // padding (e.g., if our axis is really short).

  let res: Range = [min, max];
  let maxValuePerPixel = 0;

  for (const minExtremum of minExtrema) {
    for (const maxExtremum of maxExtrema) {
      const valueRange = maxExtremum.value - minExtremum.value;
      const pixelRange = length - minExtremum.padding - maxExtremum.padding;

      if (valueRange > 0 && pixelRange > 0 && valueRange / pixelRange > maxValuePerPixel) {
        maxValuePerPixel = valueRange / pixelRange;
        res = [
          minExtremum.value - maxValuePerPixel * minExtremum.padding,
          maxExtremum.value + maxValuePerPixel * maxExtremum.padding
        ];
      }
    }
  }

  return res;
};

const lastAutoRanges: Partial<Record<AxisKey, Range>> = {};
let zoomRanges: Partial<Record<AxisKey, Range>> = {};
let zoomTitles: string | undefined;
// Note: we keep track of the user's zoom ranges, so that they are kept when our data gets updated (e.g., while a
//       simulation is running). They get reset when the user resets the zoom (using our context menu or by
//       double-clicking on our plotting area, on a corner, or on the middle of an axis, in which case only the zoom
//       along that axis gets reset) or when our axis titles change (i.e. when we are plotting something else, see
//       updatePlot()).

const naturalRange = (u: uPlot, axisKey: AxisKey): Range => {
  // Return the natural range of the given axis, i.e. the given range for the axis, if any, or the autorange of our data
  // otherwise.

  // If a range was given for the axis and it can be plotted (i.e. it is finite and, for a logarithmic axis, positive,
  // see plotValue()), then we use it.

  const givenRange = axisKey === 'x' ? props.data.xAxisRange : props.data.yAxisRange;
  const range: Range | undefined = givenRange && [plotValue(axisKey, givenRange[0]), plotValue(axisKey, givenRange[1])];

  if (range && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
    // Make sure that the given range is in increasing order (e.g., if our ending point is before our starting point)
    // and has a non-zero width (e.g., if our starting and ending points are the same) since uPlot can handle neither.
    // Note: like Plotly, we widen a zero-width range by 1 or 1ppm, whichever is bigger.

    const min = Math.min(range[0], range[1]);
    const max = Math.max(range[0], range[1]);

    if (min === max) {
      const delta = Math.max(1, 1e-6 * Math.abs(min));

      return [min - delta, max + delta];
    }

    return [min, max];
  }

  // No range was given, so we use the range of our data.
  // Note: we determine the range of our data ourselves, from the statistics of our values (see plotValues()), rather
  //       than let uPlot determine it (see the auto property of our series in createPlot()). Indeed, uPlot would go
  //       through all of our values whenever our data gets updated, and its range may not be finite (e.g., if a trace
  //       starts with a NaN value, uPlot never moves away from it, or if it has an infinite value).

  const finiteRange = finiteDataRange(u, axisKey);

  if (!finiteRange) {
    // No (finite) data, so if some of our traces are hidden (e.g., the user hid all of them using our legend), then we
    // keep our last autorange (so that the user sees the same view when showing some traces again). Otherwise, we use
    // Plotly's default range.

    const lastAutoRange = lastAutoRanges[axisKey];

    if (lastAutoRange && u.series.some((series: uPlot.Series, index: number) => index > 0 && !series.show)) {
      return [...lastAutoRange];
    }

    return axisKey === 'x' ? [...DEFAULT_X_RANGE] : [...DEFAULT_Y_RANGE];
  }

  const [min, max] = finiteRange;

  // Autorange our axis and keep track of it.
  // Note: we keep track of it here rather than rely on uPlot's scales since our plot may get recreated (e.g., when the
  //       theme changes) while all our traces are hidden.

  const res = autoRange(u, axisKey, min, max);

  lastAutoRanges[axisKey] = res;

  return [...res];
};

const scaleRange = (axisKey: AxisKey): uPlot.Range.Function => {
  return (u: uPlot): Range => {
    // If the axis is being animated, then we use its animated range (e.g., if our data gets updated while we are
    // animating a zoom, see animateScales()).

    const animatedRange = animatedRanges[axisKey];

    if (animatedRange) {
      return [...animatedRange];
    }

    // If the user zoomed into a range for the axis, then we use it.

    const zoomRange = zoomRanges[axisKey];

    if (zoomRange) {
      return [...zoomRange];
    }

    // Use the natural range of the axis.

    return naturalRange(u, axisKey);
  };
};

// Zoom functionality.

const currentRange = (axisKey: AxisKey): Range | undefined => {
  // Return the current range of the given axis, if any.

  const min = plot?.scales[axisKey]?.min;
  const max = plot?.scales[axisKey]?.max;

  return min == null || max == null ? undefined : [min, max];
};

const setScales = (ranges: Partial<Record<AxisKey, Range | null>>): void => {
  // Set the scales of our plot to the given ranges with a null range meaning that the corresponding axis gets
  // autoranged (see scaleRange()).
  // Note #1: uPlot calls our range function when the min/max of a scale is null, hence the cast.
  // Note #2: in mode 2, uPlot invalidates the paths of our traces when our Y scale changes and whenever our X scale is
  //          set, so our traces always get redrawn.

  const currentPlot = plot;

  if (!currentPlot) {
    return;
  }

  currentPlot.batch(() => {
    for (const axisKey of ['x', 'y'] as AxisKey[]) {
      const range = ranges[axisKey];

      if (range !== undefined) {
        currentPlot.setScale(axisKey, {
          min: range?.[0],
          max: range?.[1]
        } as { min: number; max: number });
      }
    }
  });
};

// Zoom animations, i.e. our ranges smoothly go from their current values to their new values (or their natural values
// if they get reset) rather than jump to them.
// Note #1: while animating, our range function uses our animated ranges (see scaleRange()), so that an update of our
//          data (e.g., while a simulation is running) doesn't interfere with our animation.
// Note #2: an update of our data may, however, change the natural range of an axis that gets reset, so we update its
//          target whenever our data changes (see stepRangeAnimation()), so that it ends up at its natural range rather
//          than jump to it once we are done animating.
// Note #3: we don't animate if the user prefers reduced motion.

interface RangeAnimation {
  from: Partial<Record<AxisKey, Range>>;
  to: Partial<Record<AxisKey, Range>>;
  final: Partial<Record<AxisKey, Range | null>>;
  data: uPlot.AlignedData;
  start: number;
  duration: number;
}

let rangeAnimation: RangeAnimation | undefined;
let rangeAnimationRafId: number | undefined;
let animatedRanges: Partial<Record<AxisKey, Range>> = {};

const targetRange = (axisKey: AxisKey): Range | undefined => {
  // Return the range that the given axis has or will have once we are done animating it.

  return rangeAnimation?.to[axisKey] ?? currentRange(axisKey);
};

const frameTime = (): number => {
  // Return the time of the current frame, i.e. the time that gets passed to the frame callbacks of the current frame
  // (e.g., stepRangeAnimation(), see common.requestFrame()), or the current time if it is not available.
  // Note: an animation must start at the time of the current frame rather than at the current time. Indeed, if a frame
  //       takes long (e.g., because redrawing our plot is slow) and an animation gets (re)started late in it (e.g.,
  //       when using the mouse wheel, see applyWheelZoom()), then the next frame may start at about the same time as
  //       our animation, in which case its first step would not make any progress. So, if our animation was to keep
  //       being restarted (e.g., when using a trackpad, which sends wheel events every frame), then it would never make
  //       any progress.

  const time = document.timeline?.currentTime;

  return typeof time === 'number' ? time : performance.now();
};

const animateScales = (final: Partial<Record<AxisKey, Range | null>>, duration: number): void => {
  // Animate the scales of our plot from their current ranges to the given ones (with a null range meaning that the
  // corresponding axis gets autoranged, see setScales()) over the given duration, carrying on with the axes that we may
  // already be animating.

  // Make sure that we have a plot to animate.

  const u = plot;

  if (!u) {
    return;
  }

  // Merge our final ranges with the final ranges of our current animation, if any, so that we don't lose any axes that
  // we are already animating.

  const mergedFinal = { ...rangeAnimation?.final, ...final };

  if (duration <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stopRangeAnimation();
    setScales(mergedFinal);

    return;
  }

  // Determine the ranges that we are animating from and to, using our current ranges as the starting point for our
  // animation (which, if we are already animating, are our current animated ranges, so that we carry on smoothly), and
  // our final ranges as the ending point for our animation (with a null range meaning that the corresponding axis gets
  // autoranged, see setScales()).

  const from: Partial<Record<AxisKey, Range>> = {};
  const to: Partial<Record<AxisKey, Range>> = {};

  for (const axisKey of Object.keys(mergedFinal) as AxisKey[]) {
    const range = currentRange(axisKey);

    if (range) {
      from[axisKey] = range;
      to[axisKey] = mergedFinal[axisKey] ?? naturalRange(u, axisKey);
    }
  }

  // Start our animation or, if we are already animating, carry on with it using our new ranges.

  rangeAnimation = {
    from,
    to,
    final: mergedFinal,
    data: u.data,
    start: frameTime(),
    duration
  };

  rangeAnimationRafId ??= common.requestFrame(stepRangeAnimation);
};

const stepRangeAnimation = (now: number): void => {
  // Move our ranges one step closer to their target, using an ease-out (cubic) curve, or finish our animation if we are
  // done.

  rangeAnimationRafId = undefined;

  // Make sure that we are animating.

  const animation = rangeAnimation;

  if (!animation) {
    return;
  }

  // Determine how far we are through our animation, clamping to 0% if we are before its start, and finish our animation
  // if we have reached its end.

  const progress = Math.max(0, (now - animation.start) / animation.duration);

  if (progress >= 1) {
    finishRangeAnimation();

    return;
  }

  // Update the target of our axes that get reset if our data has changed since we last determined it (e.g., while a
  // simulation is running).
  // Note: uPlot replaces its data whenever it is given new data (see updatePlot()), so we can just compare references.

  const u = plot;

  if (u && u.data !== animation.data) {
    animation.data = u.data;

    for (const axisKey of Object.keys(animation.to) as AxisKey[]) {
      if (animation.final[axisKey] === null) {
        animation.to[axisKey] = naturalRange(u, axisKey);
      }
    }
  }

  // Move our ranges one step closer to their target.

  const easedProgress = 1 - (1 - progress) ** 3;

  animatedRanges = {};

  for (const axisKey of Object.keys(animation.to) as AxisKey[]) {
    const from = animation.from[axisKey];
    const to = animation.to[axisKey];

    if (from && to) {
      animatedRanges[axisKey] = [
        from[0] + easedProgress * (to[0] - from[0]),
        from[1] + easedProgress * (to[1] - from[1])
      ];
    }
  }

  // Update our scales to our new ranges.

  setScales(animatedRanges);

  rangeAnimationRafId = common.requestFrame(stepRangeAnimation);
};

const stopRangeAnimation = (): void => {
  // Stop our animation, if any, leaving our ranges as they currently are.

  if (rangeAnimationRafId !== undefined) {
    common.cancelFrame(rangeAnimationRafId);

    rangeAnimationRafId = undefined;
  }

  rangeAnimation = undefined;
  animatedRanges = {};
};

const finishRangeAnimation = (): void => {
  // Finish our animation, if any, i.e. set our ranges to their final values.

  const animation = rangeAnimation;

  stopRangeAnimation();

  if (animation) {
    setScales(animation.final);
  }
};

const zoomTo = (ranges: Partial<Record<AxisKey, Range>>, duration: number = 0): void => {
  // Zoom into the given ranges, animating our zoom over the given duration, but only if they are all valid (see
  // isValidRange()).

  for (const range of Object.values(ranges)) {
    if (!isValidRange(range)) {
      return;
    }
  }

  zoomRanges = { ...zoomRanges, ...ranges };

  if (duration > 0) {
    animateScales(ranges, duration);
  } else {
    finishRangeAnimation();
    setScales(ranges);
  }
};

const zoomBy = (
  factor: number,
  axisKeys: AxisKey[],
  centerFractions: Partial<Record<AxisKey, number>>,
  duration: number
): void => {
  // Scale the range of the given axes by the given factor around the given fractions of their range (or their middle
  // for an axis without a fraction), animating our zoom over the given duration.
  // Note: we scale the range that an axis will have once we are done animating it (rather than its current range), so
  //       that zooming several times in a row (e.g., using the mouse wheel) is not affected by our animation. However,
  //       we zoom around what is currently under the mouse pointer.

  const ranges: Partial<Record<AxisKey, Range>> = {};

  for (const axisKey of axisKeys) {
    const range = currentRange(axisKey);
    const target = targetRange(axisKey);

    if (range && target) {
      const center = range[0] + (range[1] - range[0]) * (centerFractions[axisKey] ?? 0.5);

      ranges[axisKey] = scaledRange(target, center, factor);
    }
  }

  zoomTo(ranges, duration);
};

let contextMenuCenterFractions: Partial<Record<AxisKey, number>> = {};

const zoomIn = (): void => {
  // Zoom in around where our context menu was requested (see onContextMenu()).

  zoomBy(ZOOM_FACTOR, ['x', 'y'], contextMenuCenterFractions, ZOOM_ANIMATION_DURATION);
};

const zoomOut = (): void => {
  // Zoom out around where our context menu was requested (see onContextMenu()).

  zoomBy(1 / ZOOM_FACTOR, ['x', 'y'], contextMenuCenterFractions, ZOOM_ANIMATION_DURATION);
};

const resetZoom = (axisKeys: AxisKey[] = ['x', 'y']): void => {
  // Like Plotly, reset the zoom of the given axes, i.e. go back to the given ranges, if any, or autorange the axes, and
  // animate our reset.

  const ranges: Partial<Record<AxisKey, null>> = {};

  for (const axisKey of axisKeys) {
    delete zoomRanges[axisKey];

    ranges[axisKey] = null;
  }

  animateScales(ranges, ZOOM_ANIMATION_DURATION);
};

// Logarithmic axis toggling (see contextMenuItems).

const toggleLogAxis = (axisKey: AxisKey): void => {
  // Toggle whether the given axis is logarithmic, keeping its zoom range, if any and if possible (i.e. unless it has a
  // non-positive end and the axis becomes logarithmic, in which case the axis gets autoranged), and replot our data
  // (see plotData()).
  // Note: the ranges of a logarithmic axis are the decimal logarithm of its actual ranges (see plotValue()), hence we
  //       convert its zoom range and forget its last autorange.

  finishRangeAnimation();

  const zoomRange = zoomRanges[axisKey];
  const actualZoomRange: Range | undefined = zoomRange && [
    actualValue(axisKey, zoomRange[0]),
    actualValue(axisKey, zoomRange[1])
  ];

  logAxes.value = { ...logAxes.value, [axisKey]: !logAxes.value[axisKey] };

  delete zoomRanges[axisKey];
  delete lastAutoRanges[axisKey];

  if (actualZoomRange) {
    const newZoomRange: Range = [plotValue(axisKey, actualZoomRange[0]), plotValue(axisKey, actualZoomRange[1])];

    if (Number.isFinite(newZoomRange[0]) && Number.isFinite(newZoomRange[1]) && newZoomRange[0] < newZoomRange[1]) {
      zoomRanges[axisKey] = newZoomRange;
    }
  }

  updatePlot();
};

// Pointer interaction (i.e. using a mouse, a pen, or a finger), like with Plotly:
//  - our plotting area ('nsew'): drag to zoom (along both axes or, for a mostly horizontal or vertical drag, along one
//    of them), Shift+drag to pan along both axes ('pan'), use the mouse wheel to zoom around the mouse pointer, and
//    double-click (or double-tap) to reset the zoom;
//  - the middle (80%) of our axes ('ew' and 'ns'): drag to pan along that axis;
//  - the ends (10%) of our axes ('w', 'e', 'n', and 's') and the bottom corners of our plotting area ('sw' and 'se'):
//    drag to move the corresponding end(s) of our axes, and click (or tap) one end of an axis to edit its value (see
//    openRangeEditor()); and
//  - our axes: use the mouse wheel to zoom along that axis, while double-clicking (or double-tapping) the middle of an
//    axis (or a corner) resets the zoom along the corresponding axes.
// Unlike with Plotly, a drag that is done using a finger can also become a pinch, i.e. a second finger can be used to
// zoom (by moving both fingers closer to or further from each other) and pan (by moving both fingers), along both axes
// or, if the drag started on an axis, along that axis only (see startPinch()).
// Note #1: unlike Plotly, we don't have top corners (i.e. 'nw' and 'ne') since they would be above our plotting area,
//          i.e. outside of our container since we don't have a top margin (and having one, just for them, would waste
//          some valuable vertical space, especially when we have several plots stacked on top of each other). So, they
//          wouldn't be reachable (as is the case with Plotly when it doesn't have a top margin either).
// Note #2: a drag (or a pinch) can be cancelled by pressing the Escape key or another mouse button (e.g., the right
//          one), by the browser taking over its pointer, or by our window losing the focus, in which case our ranges
//          are restored (if they were changed while dragging or pinching). A zoom can also be cancelled by dragging
//          back to where it started (like with Plotly).
// Note #3: we handle our drags using pointer events (so that they also work with a pen or a finger), but we don't
//          prevent the browser from emulating mouse events (i.e. "compatibility" mouse events), so that a tap still
//          gets uPlot to move its cursor (and therefore shows our hover tooltip, see updateHover()), and a double-tap
//          still gets turned into a double-click. However, we prevent the default behaviour of a press of the main
//          mouse button (see onPressMouseDown()), so that it doesn't move the keyboard focus or start selecting some
//          text, and we use it to know how many times our mouse button was clicked (see onDragMouseDown()) since a
//          pointer event doesn't tell us.
// Note #4: a finger (or a pen) doesn't get to scroll or zoom the page when it is used on our plotting area or our axes
//          since they don't allow the browser to handle touch gestures (see touch-action below).

type DragType = 'pan' | 'nsew' | 'ew' | 'w' | 'e' | 'ns' | 'n' | 's' | 'sw' | 'se';

interface Dragger {
  type: DragType;
  left: number;
  top: number;
  width: number;
  height: number;
}

const draggers = vue.computed<Dragger[]>(() => {
  // Our axis (and corner) draggers, which are positioned around our plotting area.

  const rect = plotRect.value;

  if (!rect) {
    return [];
  }

  const { left, top, width, height } = rect;
  const right = left + width;
  const bottom = top + height;
  const xDraggerTop = bottom + AXIS_DRAGGER_OFFSET;
  const yDraggerLeft = left - AXIS_DRAGGER_OFFSET - DRAGGER_SIZE;

  return [
    { type: 'ew', left: left + 0.1 * width, top: xDraggerTop, width: 0.8 * width, height: DRAGGER_SIZE },
    { type: 'w', left, top: xDraggerTop, width: 0.1 * width, height: DRAGGER_SIZE },
    { type: 'e', left: left + 0.9 * width, top: xDraggerTop, width: 0.1 * width, height: DRAGGER_SIZE },
    { type: 'ns', left: yDraggerLeft, top: top + 0.1 * height, width: DRAGGER_SIZE, height: 0.8 * height },
    { type: 's', left: yDraggerLeft, top: top + 0.9 * height, width: DRAGGER_SIZE, height: 0.1 * height },
    { type: 'n', left: yDraggerLeft, top, width: DRAGGER_SIZE, height: 0.1 * height },
    { type: 'sw', left: left - DRAGGER_SIZE, top: bottom, width: DRAGGER_SIZE, height: DRAGGER_SIZE },
    { type: 'se', left: right, top: bottom, width: DRAGGER_SIZE, height: DRAGGER_SIZE }
  ];
});

const draggedAxes = (type: DragType): AxisKey[] => {
  // Return the axes that are affected by the given type of drag.

  const res: AxisKey[] = [];

  if (type === 'pan' || type === 'nsew' || /[ew]/.test(type)) {
    res.push('x');
  }

  if (type === 'pan' || type === 'nsew' || /[ns]/.test(type)) {
    res.push('y');
  }

  return res;
};

type ZoomMode = '' | 'x' | 'y' | 'xy';

interface ZoomBox {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeWidth: number;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PinchPointer {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

interface Pinch {
  pointers: Map<number, PinchPointer>;
  axisKeys: AxisKey[];
  xRange: Range;
  yRange: Range;
}

interface Drag {
  type: DragType;
  pointerId: number;
  pointerType: string;
  clickCount: number | undefined;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  xRange: Range;
  yRange: Range;
  zoomMode: ZoomMode;
  zoomRanges: Partial<Record<AxisKey, Range>>;
  box: Box;
  pinch: Pinch | undefined;
}

interface WheelZoom {
  factor: number;
  axisKeys: AxisKey[];
  centerFractions: Record<AxisKey, number>;
}

const zoomBox = vue.shallowRef<ZoomBox | null>(null);
const dragCursor = vue.shallowRef<string | null>(null);
// Note: while dragging, we cover the whole window with an element that uses the cursor of our drag (see our template),
//       like Plotly does. This means that our cursor doesn't change while dragging (e.g., when moving over one of our
//       axis draggers or over another part of the window), which would otherwise give the impression that another
//       action could be started. We also prevent the page from scrolling if the mouse wheel is used over that element.
let drag: Drag | undefined;
let dragRafId: number | undefined;
let pendingWheelZoom: WheelZoom | undefined;
let wheelRafId: number | undefined;

const plotPosition = (
  event: MouseEvent,
  rect: PlotRect
): {
  x: number;
  y: number;
} => {
  // Return the position of the given mouse (or pointer) event relative to our plotting area.

  const mainDivRect = mainDivRef.value?.getBoundingClientRect();

  return {
    x: event.clientX - (mainDivRect?.left ?? 0) - rect.left,
    y: event.clientY - (mainDivRect?.top ?? 0) - rect.top
  };
};

const dZoom = (fraction: number): number => {
  // Like Plotly, return the (non-linear) scaling of a range when moving one of its ends by the given fraction of its
  // length.

  return 1 - (fraction >= 0 ? Math.min(fraction, 0.9) : 1 / (1 / Math.max(fraction, -0.3) + 3.222));
};

const applyDrag = (currentDrag: Drag): void => {
  // Make sure that our plot has been laid out and that we are not dragging our plotting area (see onDragMove()).

  const rect = plotRect.value;

  if (!rect || currentDrag.type === 'nsew') {
    return;
  }

  // Determine the new ranges of our axes based on how far we have dragged.

  const { type, dx, dy, xRange, yRange } = currentDrag;
  const ranges: Partial<Record<AxisKey, Range>> = {};

  const moveEnd = (range: Range, end: 0 | 1, distance: number, length: number): Range => {
    const otherEnd = end === 0 ? 1 : 0;
    const res: Range = [range[0], range[1]];

    res[end] = range[otherEnd] + (range[end] - range[otherEnd]) / dZoom(distance / length);

    return res;
  };

  // Move our axes or move one/both ends of our axes, depending on what we are dragging.

  if (type === 'pan' || type === 'ew') {
    const delta = (dx * (xRange[1] - xRange[0])) / rect.width;

    ranges.x = [xRange[0] - delta, xRange[1] - delta];
  }

  if (type === 'pan' || type === 'ns') {
    const delta = (dy * (yRange[1] - yRange[0])) / rect.height;

    ranges.y = [yRange[0] + delta, yRange[1] + delta];
  }

  if (type !== 'pan' && type !== 'ew' && type !== 'ns') {
    if (type.includes('w')) {
      ranges.x = moveEnd(xRange, 0, dx, rect.width);
    } else if (type.includes('e')) {
      ranges.x = moveEnd(xRange, 1, -dx, rect.width);
    }

    if (type.includes('n')) {
      ranges.y = moveEnd(yRange, 1, dy, rect.height);
    } else if (type.includes('s')) {
      ranges.y = moveEnd(yRange, 0, -dy, rect.height);
    }
  }

  // Zoom into the new ranges.

  zoomTo(ranges);
};

const onDragStart = (event: PointerEvent, type: DragType): void => {
  // Only start dragging with the main button of a pointer (e.g., not with the right mouse button) and with a primary
  // pointer (e.g., not with a second finger, which can only be used to pinch while dragging, see onDragPointerDown()).

  if (event.button !== 0 || !event.isPrimary) {
    return;
  }

  // Apply our pending wheel zoom, if any, so that it doesn't get applied while dragging (in which case our drag would
  // be based on ranges that are not the ones that are shown anymore).

  if (wheelRafId !== undefined) {
    common.cancelFrame(wheelRafId);

    wheelRafId = undefined;

    applyWheelZoom();
  }

  // Finish our zoom animation, if any, so that our drag is based on our final ranges.

  finishRangeAnimation();

  // Start dragging, but only if our plot has been laid out.

  const rect = plotRect.value;
  const xRange = currentRange('x');
  const yRange = currentRange('y');

  if (!rect || !xRange || !yRange) {
    return;
  }

  // Make sure that we are not already dragging.
  // Note: this shouldn't be the case since we ignore any press of another pointer while dragging (see
  //       onDragPointerDown()), but better be safe than sorry.

  stopDrag();

  // Keep track of what we are dragging, the pointer with which we are dragging, our starting (and current) position,
  // our current ranges, a copy of our zoom ranges (so that cancelDrag() can restore them), and our zoom box.
  // Note: we only know how many times a mouse (or a pen) has been clicked once its mouse press has been emulated (see
  //       onDragMouseDown()), while a press using a finger is considered as a single click (since its mouse press is
  //       only emulated once it has been released, if at all, i.e. after our drag is over).

  const position = plotPosition(event, rect);

  drag = {
    type,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    clickCount: event.pointerType === 'touch' ? 1 : undefined,
    startX: position.x,
    startY: position.y,
    x: position.x,
    y: position.y,
    dx: 0,
    dy: 0,
    xRange,
    yRange,
    zoomMode: '',
    zoomRanges: {
      ...zoomRanges
    },
    box: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0
    },
    pinch: undefined
  };

  // Listen for pointer, mouse, and keyboard events on the window, as well as for it losing focus, so that we can
  // continue to drag even if our pointer leaves our plotting area, start pinching, and cancel our drag if needed.

  window.addEventListener('pointerdown', onDragPointerDown, true);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragPointerCancel);
  window.addEventListener('mousedown', onDragMouseDown, true);
  window.addEventListener('keydown', onDragKeyDown, true);
  window.addEventListener('blur', cancelDrag);
};

const onDragMove = (event: PointerEvent): void => {
  // Make sure that we are dragging and that our plot has been laid out.

  const currentDrag = drag;
  const rect = plotRect.value;

  if (!currentDrag || !rect) {
    return;
  }

  // Let our pinch, if any, handle the move of one of its pointers.

  if (currentDrag.pinch) {
    movePinch(currentDrag.pinch, event, rect);

    return;
  }

  // Make sure that it is the pointer with which we are dragging that has moved.

  if (event.pointerId !== currentDrag.pointerId) {
    return;
  }

  // Determine (and keep track of) the position of our pointer relative to our plotting area.

  const position = plotPosition(event, rect);

  currentDrag.x = position.x;
  currentDrag.y = position.y;

  // Use the cursor of our drag while dragging (see dragCursor), but only once our mouse has moved far enough from where
  // our drag started.
  // Note: a click (or a double-click) often comes with a bit of mouse movement, in which case our mouse button would be
  //       released over the element that we use to cover the whole window. The click would then be dispatched to the
  //       nearest common ancestor of where our mouse button was pressed and released, i.e. not to us, so we wouldn't
  //       get it (e.g., we wouldn't reset our zoom when our plotting area gets double-clicked).

  if (
    !dragCursor.value &&
    Math.max(Math.abs(position.x - currentDrag.startX), Math.abs(position.y - currentDrag.startY)) >= MIN_DRAG
  ) {
    dragCursor.value =
      currentDrag.type === 'pan' ? 'move' : currentDrag.type === 'nsew' ? 'crosshair' : `${currentDrag.type}-resize`;
  }

  // If we are panning our plotting area or dragging an axis (or a corner), then pan/move our axes, coalescing our
  // pans/moves into one per frame, but only once our mouse has moved far enough from where our drag started (like
  // Plotly, which otherwise considers that we are clicking, see onDragEnd()).

  if (currentDrag.type !== 'nsew') {
    // Make sure that we have moved far enough from where our drag started.

    if (!dragCursor.value) {
      return;
    }

    // Keep track of how far we have dragged.

    currentDrag.dx = position.x - currentDrag.startX;
    currentDrag.dy = position.y - currentDrag.startY;

    if (dragRafId === undefined) {
      dragRafId = common.requestFrame(() => {
        dragRafId = undefined;

        if (drag) {
          applyDrag(drag);
        }
      });
    }

    return;
  }

  // We are dragging our plotting area, so determine the zoom mode based on how far we have dragged along each axis.

  const x0 = currentDrag.startX;
  const y0 = currentDrag.startY;
  const x1 = Math.max(0, Math.min(rect.width, position.x));
  const y1 = Math.max(0, Math.min(rect.height, position.y));
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const box = { left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };

  if (dy < Math.min(Math.max(0.6 * dx, MIN_DRAG), MIN_ZOOM)) {
    if (dx < MIN_DRAG) {
      currentDrag.zoomMode = '';
      box.right = box.left;
      box.top = box.bottom;
    } else {
      currentDrag.zoomMode = 'x';
      box.top = 0;
      box.bottom = rect.height;
    }
  } else if (dx < Math.min(0.6 * dy, MIN_ZOOM)) {
    currentDrag.zoomMode = 'y';
    box.left = 0;
    box.right = rect.width;
  } else {
    currentDrag.zoomMode = 'xy';
  }

  currentDrag.box = box;

  // Update our zoom box, which is shown on top of our plot (unless we haven't dragged far enough to zoom yet).
  // Note: like our grid and zero lines (see linesPath()), our zoom box is snapped to whole device pixels and its border
  //       is a whole number of device pixels wide (see lineWidth()), so that it is crisp whatever our pixel ratio
  //       (e.g., 125%). Its border is also drawn inside our zoom box, which itself is kept within our plotting area.

  if (currentDrag.zoomMode) {
    const pxRatio = uPlot.pxRatio;
    const strokeWidth = lineWidth(pxRatio);
    const left = Math.round(box.left * pxRatio);
    const top = Math.round(box.top * pxRatio);
    const right = Math.min(Math.round(box.right * pxRatio), Math.round(rect.width * pxRatio));
    const bottom = Math.min(Math.round(box.bottom * pxRatio), Math.round(rect.height * pxRatio));

    zoomBox.value = {
      x: (left + 0.5 * strokeWidth) / pxRatio,
      y: (top + 0.5 * strokeWidth) / pxRatio,
      width: Math.max(0, right - left - strokeWidth) / pxRatio,
      height: Math.max(0, bottom - top - strokeWidth) / pxRatio,
      strokeWidth: strokeWidth / pxRatio
    };
  } else {
    zoomBox.value = null;
  }
};

const onDragEnd = (event: PointerEvent): void => {
  // Make sure that we are dragging.
  // Note: this should always be the case since we only listen to pointerup events while dragging (see onDragStart() and
  //       stopDrag()).

  const currentDrag = drag;

  if (!currentDrag) {
    return;
  }

  // Finish our pinch, if any, once one of its pointers has been released, making sure that our axes reflect where we
  // stopped pinching.
  // Note: we don't go back to dragging with the pointer that is still pressed, if any, since its drag would have to
  //       start from wherever it is now (rather than from where our original drag started), which could be confusing.

  const pinch = currentDrag.pinch;

  if (pinch) {
    if (pinch.pointers.has(event.pointerId)) {
      applyPinch(pinch);
      stopDrag();
    }

    return;
  }

  // Finish our drag, but only if it is the main button of the pointer with which we are dragging that has been
  // released.

  if (event.pointerId !== currentDrag.pointerId || event.button !== 0) {
    return;
  }

  // Stop dragging.
  // Note: we must keep track of whether we actually dragged (see onDragMove()) before stopping our drag since stopping
  //       it resets it.

  const dragged = !!dragCursor.value;

  stopDrag();

  // If we were dragging an axis (or a corner), then make sure that our axes reflect where we stopped dragging or, like
  // Plotly, open our range editor if we clicked one end of an axis (but not if it is the second click of a
  // double-click, see onDoubleClick()).

  if (currentDrag.type !== 'nsew') {
    if (dragged) {
      applyDrag(currentDrag);
    } else if (isAxisEnd(currentDrag.type) && (currentDrag.clickCount ?? 1) <= 1) {
      openRangeEditor(currentDrag.type);
    }

    return;
  }

  // We were dragging our plotting area, so make sure that we have a zoom box and that our plot has been laid out.

  const rect = plotRect.value;

  if (!currentDrag.zoomMode || !rect) {
    return;
  }

  // Determine the new ranges of our axes based on our zoom box.
  // Note: our zoom box is relative to what is currently shown, which may not be what was shown when we started dragging
  //       (e.g., if our data got updated while a simulation is running, in which case our axes may have been autoranged
  //       again), so we use our current ranges rather than the ones from when we started dragging.

  const { zoomMode, box } = currentDrag;
  const xRange = currentRange('x') ?? currentDrag.xRange;
  const yRange = currentRange('y') ?? currentDrag.yRange;
  const ranges: Partial<Record<AxisKey, Range>> = {};

  if (zoomMode === 'x' || zoomMode === 'xy') {
    ranges.x = [
      xRange[0] + ((xRange[1] - xRange[0]) * box.left) / rect.width,
      xRange[0] + ((xRange[1] - xRange[0]) * box.right) / rect.width
    ];
  }

  if (zoomMode === 'y' || zoomMode === 'xy') {
    ranges.y = [
      yRange[1] - ((yRange[1] - yRange[0]) * box.bottom) / rect.height,
      yRange[1] - ((yRange[1] - yRange[0]) * box.top) / rect.height
    ];
  }

  // Zoom into the given ranges (animating our zoom), but only if they are all valid (e.g., not if we zoomed in so much
  // that the two ends of a range are the same number).

  zoomTo(ranges, ZOOM_ANIMATION_DURATION);
};

const onDragKeyDown = (event: KeyboardEvent): void => {
  // Cancel our drag if the user presses the Escape key.
  // Note: we stop the propagation of the event, so that it doesn't also get handled by something else (e.g., a dialog
  //       that would get closed).

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();

    cancelDrag();
  }
};

const onDragPointerDown = (event: PointerEvent): void => {
  // Make sure that it is another pointer than the one with which we are dragging that has been pressed.
  // Note: this should always be the case since we start listening to pointer presses once our pointer has been pressed
  //       (see onDragStart()), and a pointer can only be pressed again once it has been released (in which case our
  //       drag is over), but better be safe than sorry.

  const currentDrag = drag;

  if (!currentDrag || event.pointerId === currentDrag.pointerId) {
    return;
  }

  // Ignore the press of another pointer (so that it can't start another drag, e.g., of one of our axes while zooming
  // into our plotting area, or trigger anything else), unless we are dragging using a finger and it is a second finger,
  // in which case our drag becomes a pinch (see startPinch()).
  // Note: we listen to pointer presses in the capture phase (see onDragStart()), so we get them before anything else.
  //       We also prevent their default behaviour, so that their mouse presses don't get emulated (see Note #3 above).

  event.preventDefault();
  event.stopPropagation();

  if (event.pointerType === 'touch' && currentDrag.pointerType === 'touch' && !currentDrag.pinch) {
    startPinch(currentDrag, event);
  }
};

const onDragPointerCancel = (event: PointerEvent): void => {
  // Cancel our drag (or pinch) if the browser has taken over (one of) its pointer(s) (see Note #2 above).

  const currentDrag = drag;

  if (currentDrag && (event.pointerId === currentDrag.pointerId || currentDrag.pinch?.pointers.has(event.pointerId))) {
    cancelDrag();
  }
};

const onDragMouseDown = (event: MouseEvent): void => {
  // Keep track of how many times our mouse button has been clicked when its press (with which our drag started) gets
  // emulated (see Note #3 above), and prevent it from moving the keyboard focus or selecting some text (see
  // onPressMouseDown()). Ignore any other press of the main mouse button while dragging (e.g., using another pointing
  // device), so that it can't start another drag (e.g., of one of our axes while zooming into our plotting area).
  // Otherwise, cancel our drag if the user presses another mouse button (e.g., the right one), in which case we also
  // prevent the context menu that would normally be shown as a result of that mouse button being pressed (see
  // preventContextMenu()).
  // Note #1: we listen to mouse presses in the capture phase (see onDragStart()), so we get them before anything else.
  // Note #2: a context menu is shown either when the right mouse button is pressed (e.g., on macOS) or released (e.g.,
  //          on Windows), so we prevent the next context menu from being shown, whenever that is. We also stop
  //          preventing it when another mouse button gets pressed (e.g., if the context menu event didn't get fired for
  //          some reason).
  // Note #3: pressing another mouse button while our main mouse button is pressed doesn't result in a pointer press
  //          (but in a pointer move), so we rely on its mouse press to cancel our drag.

  if (event.button === 0) {
    event.preventDefault();

    if (drag && drag.clickCount === undefined) {
      drag.clickCount = event.detail;
    } else {
      event.stopPropagation();
    }

    return;
  }

  event.preventDefault();
  event.stopPropagation();

  cancelDrag();

  window.addEventListener('contextmenu', preventContextMenu, true);
  window.addEventListener(
    'mousedown',
    () => {
      window.removeEventListener('contextmenu', preventContextMenu, true);
    },
    { capture: true, once: true }
  );
};

const onPressMouseDown = (event: MouseEvent): void => {
  // Prevent a press of the main mouse button on our plotting area or one of our axes (be it a real one or one that is
  // emulated, e.g., after a tap, see Note #3 above) from moving the keyboard focus (e.g., away from an input field that
  // is being edited) or from selecting some text.

  if (event.button === 0) {
    event.preventDefault();
  }
};

// Pinching, i.e. zooming (and panning) using two fingers, around the point between them (see the beginning of the
// pointer interaction section above).
// Note: we scale our ranges by how much closer to (or further from) each other our fingers have moved, and we pan them,
//       so that what was originally between our fingers remains between them.

const startPinch = (currentDrag: Drag, event: PointerEvent): void => {
  // Make sure that our plot has been laid out.

  const rect = plotRect.value;
  const xRange = currentRange('x');
  const yRange = currentRange('y');

  if (!rect || !xRange || !yRange) {
    return;
  }

  // Stop dragging and start pinching using the finger with which we were dragging (from where it currently is) and the
  // second finger, using our current ranges (which we may have changed while dragging, e.g., an axis).

  if (dragRafId !== undefined) {
    common.cancelFrame(dragRafId);

    dragRafId = undefined;
  }

  const position = plotPosition(event, rect);

  currentDrag.zoomMode = '';
  currentDrag.pinch = {
    pointers: new Map([
      [currentDrag.pointerId, { startX: currentDrag.x, startY: currentDrag.y, x: currentDrag.x, y: currentDrag.y }],
      [event.pointerId, { startX: position.x, startY: position.y, x: position.x, y: position.y }]
    ]),
    axisKeys: draggedAxes(currentDrag.type),
    xRange,
    yRange
  };

  zoomBox.value = null;
  dragCursor.value = null;
};

const movePinch = (pinch: Pinch, event: PointerEvent, rect: PlotRect): void => {
  // Make sure that it is one of our fingers that has moved.

  const pointer = pinch.pointers.get(event.pointerId);

  if (!pointer) {
    return;
  }

  // Keep track of where our finger is and pinch accordingly, coalescing our pinches into one per frame.

  const position = plotPosition(event, rect);

  pointer.x = position.x;
  pointer.y = position.y;

  if (dragRafId === undefined) {
    dragRafId = common.requestFrame(() => {
      dragRafId = undefined;

      if (drag?.pinch) {
        applyPinch(drag.pinch);
      }
    });
  }
};

const applyPinch = (pinch: Pinch): void => {
  // Make sure that our plot has been laid out and that we have two fingers that are far enough from each other for us
  // to know how much closer to (or further from) each other they have moved.

  const rect = plotRect.value;
  const [pointer1, pointer2] = Array.from(pinch.pointers.values());

  if (!rect || !pointer1 || !pointer2) {
    return;
  }

  const startDistance = Math.hypot(pointer2.startX - pointer1.startX, pointer2.startY - pointer1.startY);
  const distance = Math.hypot(pointer2.x - pointer1.x, pointer2.y - pointer1.y);

  if (startDistance < MIN_DRAG || distance < MIN_DRAG) {
    return;
  }

  // Determine the new ranges of our axes and zoom into them.

  const factor = startDistance / distance;
  const startX = 0.5 * (pointer1.startX + pointer2.startX);
  const startY = 0.5 * (pointer1.startY + pointer2.startY);
  const x = 0.5 * (pointer1.x + pointer2.x);
  const y = 0.5 * (pointer1.y + pointer2.y);
  const ranges: Partial<Record<AxisKey, Range>> = {};

  if (pinch.axisKeys.includes('x')) {
    ranges.x = pinchedRange(pinch.xRange, startX / rect.width, x / rect.width, factor);
  }

  if (pinch.axisKeys.includes('y')) {
    ranges.y = pinchedRange(
      pinch.yRange,
      (rect.height - startY) / rect.height,
      (rect.height - y) / rect.height,
      factor
    );
  }

  zoomTo(ranges);
};

const onDoubleClick = (type: DragType): void => {
  // Reset the zoom along the axes that correspond to what was double-clicked unless we are dragging (in which case only
  // our drag should have an effect).
  // Note: like Plotly, double-clicking one end of an axis does nothing.

  if (drag || isAxisEnd(type)) {
    return;
  }

  resetZoom(draggedAxes(type));
};

// Range editor, like Plotly's (see its dragbox.js and svgTextUtils.makeEditable()), i.e. a box that opens when one end
// of an axis is clicked and in which the value of that end can be edited, with Enter (or clicking elsewhere) applying
// the new value and Escape cancelling it.

type AxisEnd = 'w' | 'e' | 'n' | 's';

interface RangeEditor {
  axisKey: AxisKey;
  end: 0 | 1;
  text: string;
  left: number;
  top: number;
  transform: string | undefined;
}

const rangeEditor = vue.shallowRef<RangeEditor | null>(null);

const rangeEditorLabel = vue.computed<string | undefined>(() => {
  // Our range editor, as described to assistive technologies, i.e. the end of the range of an axis that it edits.

  const editor = rangeEditor.value;

  return editor ? `${editor.end ? 'Maximum' : 'Minimum'} of the ${editor.axisKey.toUpperCase()} axis` : undefined;
});

const isAxisEnd = (type: DragType): type is AxisEnd => {
  // Return whether the given drag type is one end of an axis.

  return type === 'w' || type === 'e' || type === 'n' || type === 's';
};

const rangeEndText = (range: Range, end: 0 | 1, logarithmic: boolean): string => {
  // Like Plotly (see its getEndText()), return the given (actual) end of the given (actual) range with four more
  // significant digits than needed to tell it apart from the other end of the range or, for a logarithmic axis, with
  // four significant digits (plus one for each power of ten by which the range is smaller than a power of ten) since
  // the ends of its range may be powers of ten apart (e.g., 0.001 and 100, in which case 0.001 would otherwise be shown
  // with only one significant digit).
  // Note: like Plotly (and d3-format, which it uses), we use toPrecision() with a precision between 1 and 21, and we
  //       return the value as is if we can't determine a precision (e.g., if it is zero).

  const value = range[end];
  const precision = logarithmic
    ? 4 + Math.max(0, -Math.floor(Math.log10(Math.abs(Math.log10(range[1] / range[0])))))
    : Math.floor(Math.log10(Math.abs(value))) - Math.floor(Math.log10(Math.abs(value - range[end === 0 ? 1 : 0]))) + 4;

  return Number.isFinite(precision) ? value.toPrecision(Math.min(Math.max(precision, 1), 21)) : String(value);
};

const rangeEndValue = (text: string): number | undefined => {
  // Like Plotly (see its cleanNumber()), return the value of the given text, ignoring some characters (e.g., leading
  // and trailing spaces, and thousands separators), if it is a valid number.

  const cleanText = text.replace(/^['"%,$#\s]+|[, ]|['"%,$#\s]+$/g, '');
  const value = Number(cleanText);

  return cleanText && Number.isFinite(value) ? value : undefined;
};

const openRangeEditor = (type: AxisEnd): void => {
  // Make sure that we have a dragger for the given axis end and a range for its axis.

  const dragger = draggers.value.find((someDragger: Dragger) => someDragger.type === type);
  const axisKey: AxisKey = type === 'w' || type === 'e' ? 'x' : 'y';
  const range = currentRange(axisKey);

  if (!dragger || !range) {
    return;
  }

  // Open our range editor, which, like Plotly's, is aligned with the right (left) edge of our X axis end dragger and
  // vertically centred on it, or with the top (bottom) edge of our Y axis end dragger and aligned with its left edge.

  const end = type === 'w' || type === 's' ? 0 : 1;

  rangeEditor.value = {
    axisKey,
    end,
    text: rangeEndText([actualValue(axisKey, range[0]), actualValue(axisKey, range[1])], end, logAxes.value[axisKey]),
    left: type === 'e' ? dragger.left + dragger.width : dragger.left,
    top:
      axisKey === 'x' ? dragger.top + 0.5 * dragger.height : type === 's' ? dragger.top + dragger.height : dragger.top,
    transform:
      type === 'e'
        ? 'translate(-100%, -50%)'
        : type === 'w'
          ? 'translateY(-50%)'
          : type === 's'
            ? 'translateY(-100%)'
            : undefined
  };

  // Select the text of our range editor once it has been rendered, and close it (applying its value) if a pointer is
  // pressed anywhere else.
  // Note #1: we listen to pointer presses (in the capture phase) rather than rely on our range editor losing focus
  //          since some of our pointer presses don't move the focus (see onPressMouseDown()).
  // Note #2: we listen to pointer presses rather than mouse presses since our range editor may have been opened using a
  //          tap, in which case a mouse press gets emulated once our range editor has been opened (see Note #3 of the
  //          pointer interaction section above), which would otherwise close it straight away.

  void vue.nextTick().then(() => {
    const element = rangeEditorRef.value;

    if (element) {
      window.getSelection()?.selectAllChildren(element);

      element.focus();
    }
  });

  window.addEventListener('pointerdown', onRangeEditorPointerDown, true);
};

const closeRangeEditor = (apply: boolean): void => {
  // Close our range editor, if it is open, applying its value if requested, valid, and changed.
  // Note #1: unlike Plotly, we ignore a value that hasn't been changed since its text is rounded (see rangeEndText()),
  //          so applying it would slightly change our range (e.g., when clicking elsewhere without having typed
  //          anything or when double-clicking one end of an axis).
  // Note #2: unlike Plotly, which would reverse our axis, we ignore a new value that would result in a reversed (or
  //          empty) range (e.g., if the new value of the right end of our X axis is to the left of its left end, see
  //          zoomTo()).

  // Make sure that our range editor is open.

  const editor = rangeEditor.value;

  if (!editor) {
    return;
  }

  // Determine the text and value of our range editor, if it is valid.
  // Note: the value is an actual value, so we convert it to the value that we plot (see plotValue()), which may not be
  //       valid (e.g., a non-positive value for a logarithmic axis).

  // Note: if our range editor has the keyboard focus (e.g., it was closed using Enter or Escape, rather than by giving
  //       the keyboard focus to something else), then we give it to our plot (since our range editor is about to be
  //       removed and the keyboard focus would otherwise be lost), e.g., so that our range editor can be opened and
  //       closed using the keyboard (see contextMenuItems).

  const text = rangeEditorRef.value?.textContent ?? '';
  const hadFocus = !!rangeEditorRef.value?.contains(document.activeElement);
  const actualRangeEndValue = rangeEndValue(text);
  const value = actualRangeEndValue === undefined ? undefined : plotValue(editor.axisKey, actualRangeEndValue);

  rangeEditor.value = null;

  window.removeEventListener('pointerdown', onRangeEditorPointerDown, true);

  if (hadFocus) {
    plotDivRef.value?.focus();
  }

  const range = currentRange(editor.axisKey);

  if (!apply || text === editor.text || value === undefined || !Number.isFinite(value) || !range) {
    return;
  }

  // Zoom into the new range, which is the same as the current one except for the end that was edited.

  const newRange: Range = [range[0], range[1]];

  newRange[editor.end] = value;

  zoomTo({ [editor.axisKey]: newRange }, ZOOM_ANIMATION_DURATION);
};

const onRangeEditorKeyDown = (event: KeyboardEvent): void => {
  // Apply the value of our range editor when Enter is pressed and cancel it when Escape is pressed.
  // Note: we stop the propagation of those keys so that they don't trigger anything else (e.g., closing a dialog).

  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();

    closeRangeEditor(event.key === 'Enter');
  }
};

const onRangeEditorPointerDown = (event: PointerEvent): void => {
  // Close our range editor (applying its value) if a pointer is pressed outside of it.

  if (!rangeEditorRef.value?.contains(event.target as Node)) {
    closeRangeEditor(true);
  }
};

const applyWheelZoom = (): void => {
  // Apply our pending wheel zoom, if any.

  if (!pendingWheelZoom) {
    return;
  }

  const { factor, axisKeys, centerFractions } = pendingWheelZoom;

  pendingWheelZoom = undefined;

  zoomBy(factor, axisKeys, centerFractions, WHEEL_ZOOM_ANIMATION_DURATION);
};

const onWheel = (event: WheelEvent, type: DragType): void => {
  // Like Plotly, don't zoom when the mouse wheel is used over a corner, in which case we let the browser scroll the
  // page. Neither do we zoom when the mouse wheel (or a trackpad) is used mostly horizontally (e.g., a horizontal swipe
  // on a trackpad, or Shift+wheel on Windows), since we only zoom using the vertical delta (i.e. a horizontal wheel
  // event would otherwise zoom by a factor of one, and therefore stop our axes from autoranging), in which case we let
  // the browser scroll the page horizontally.

  if (type === 'sw' || type === 'se' || Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) {
    return;
  }

  // Prevent the default behaviour of the mouse wheel, which is to scroll the page.

  event.preventDefault();

  // Make sure that we have a plot, that it has been laid out, and that we are not dragging (in which case only our drag
  // should have an effect).

  const rect = plotRect.value;

  if (!plot || !rect || drag) {
    return;
  }

  // Determine the position of the mouse pointer relative to our plotting area and the zoom factor based on the wheel
  // delta.
  // Note: if the wheel events that we coalesce are for different axes (e.g., if the mouse pointer moved from our
  //       plotting area to one of our axes), then we only consider the axes of the last one.

  const position = plotPosition(event, rect);
  const wheelDelta = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : 40 * event.deltaY;
  const factor = Math.exp(Math.min(Math.max(wheelDelta, -20), 20) / 200);
  const axisKeys = draggedAxes(type);

  pendingWheelZoom = {
    factor:
      (pendingWheelZoom && pendingWheelZoom.axisKeys.join() === axisKeys.join() ? pendingWheelZoom.factor : 1) * factor,
    axisKeys,
    centerFractions: {
      x: position.x / rect.width,
      y: (rect.height - position.y) / rect.height
    }
  };

  // If we already have a pending wheel zoom, then we don't need to schedule another one.

  if (wheelRafId !== undefined) {
    return;
  }

  // Schedule a wheel zoom to be applied on the next animation frame.

  wheelRafId = common.requestFrame(() => {
    wheelRafId = undefined;

    applyWheelZoom();
  });
};

const stopDrag = (): void => {
  // Stop dragging (or pinching), if we are.

  window.removeEventListener('pointerdown', onDragPointerDown, true);
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragPointerCancel);
  window.removeEventListener('mousedown', onDragMouseDown, true);
  window.removeEventListener('keydown', onDragKeyDown, true);
  window.removeEventListener('blur', cancelDrag);

  if (dragRafId !== undefined) {
    common.cancelFrame(dragRafId);

    dragRafId = undefined;
  }

  drag = undefined;
  hover.value = null;
  dragCursor.value = null;
  zoomBox.value = null;
};

const cancelDrag = (): void => {
  // Cancel our drag (or pinch), if any, restoring our ranges if we were dragging an axis (or a corner) or pinching
  // since our ranges get updated while dragging an axis (or a corner) or pinching, unlike while dragging our plotting
  // area.

  const currentDrag = drag;

  stopDrag();

  if (currentDrag && (currentDrag.type !== 'nsew' || currentDrag.pinch)) {
    zoomRanges = { ...currentDrag.zoomRanges };

    setScales({ x: zoomRanges.x ?? null, y: zoomRanges.y ?? null });
  }
};

const preventContextMenu = (event: MouseEvent): void => {
  // Prevent a context menu from being shown (see onDragMouseDown()).

  event.preventDefault();
  event.stopPropagation();

  window.removeEventListener('contextmenu', preventContextMenu, true);
};

// Keyboard interaction, i.e. once our plot has the keyboard focus (see our template):
//  - + (or =) and − (or _): zoom in and out, around the middle of our plotting area;
//  - 0: reset the zoom;
//  - the arrow keys: pan along the corresponding axis; and
//  - Shift+F10 (or the context menu key): show our context menu (see showContextMenuUsingKeyboard()).
// Note: we leave a key alone if it is used with Ctrl, Cmd, or Alt (e.g., Ctrl+− to zoom out the whole page), and we
//       ignore our keys while dragging (in which case only our drag should have an effect, see onDragKeyDown()).

const KEYBOARD_PAN_FRACTION = 0.1; // Fraction of the length of an axis by which it gets panned using an arrow key.

const plotDescriptionId = `plot-description-${vue.useId()}`;
const legendDescriptionId = `legend-description-${vue.useId()}`;

const plainText = (html: string | undefined): string => {
  // Return the text of the given HTML (e.g., "<i>I<sub>K,r</sub></i>" becomes "IK,r").
  // Note: we parse our HTML in a separate document, so that nothing in it gets loaded or run (e.g., an image).

  return html ? (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim() : '';
};

const plotLabel = vue.computed<string>(() => {
  // Our plot, as described to assistive technologies, i.e. based on the titles of our axes, if any.

  const xAxisTitle = plainText(props.data.xAxisTitle);
  const yAxisTitle = plainText(props.data.yAxisTitle);

  if (xAxisTitle && yAxisTitle) {
    return `Plot of ${yAxisTitle} against ${xAxisTitle}`;
  }

  if (yAxisTitle) {
    return `Plot of ${yAxisTitle}`;
  }

  return xAxisTitle ? `Plot against ${xAxisTitle}` : 'Plot';
});

const panBy = (axisKey: AxisKey, direction: 1 | -1): void => {
  // Pan the given axis in the given direction by a fraction of its length, from the range that it will have once we are
  // done animating it (so that panning several times in a row, e.g., by keeping an arrow key pressed, is not affected
  // by our animation, see zoomBy()).

  const range = targetRange(axisKey);

  if (!range) {
    return;
  }

  const delta = direction * KEYBOARD_PAN_FRACTION * (range[1] - range[0]);

  zoomTo({ [axisKey]: [range[0] + delta, range[1] + delta] }, WHEEL_ZOOM_ANIMATION_DURATION);
};

const onPlotKeyDown = (event: KeyboardEvent): void => {
  // Make sure that we are not dragging and that our plot has been laid out.

  if (drag || !plotRect.value) {
    return;
  }

  // Show our context menu.

  if (
    (event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) ||
    event.key === 'ContextMenu'
  ) {
    event.preventDefault();

    showContextMenuUsingKeyboard();

    return;
  }

  // Zoom, reset the zoom, or pan.

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  switch (event.key) {
    case '+':
    case '=':
      zoomBy(ZOOM_FACTOR, ['x', 'y'], {}, ZOOM_ANIMATION_DURATION);

      break;
    case '-':
    case '_':
      zoomBy(1 / ZOOM_FACTOR, ['x', 'y'], {}, ZOOM_ANIMATION_DURATION);

      break;
    case '0':
      resetZoom();

      break;
    case 'ArrowLeft':
      panBy('x', -1);

      break;
    case 'ArrowRight':
      panBy('x', 1);

      break;
    case 'ArrowDown':
      panBy('y', -1);

      break;
    case 'ArrowUp':
      panBy('y', 1);

      break;
    default:
      return;
  }

  event.preventDefault();
};

// Number formatting like in Plotly (with its default 'B' exponent format, i.e. SI prefixes except for 10^9 which is B).

const MINUS_SIGN = '−';
const SI_PREFIXES = ['f', 'p', 'n', 'μ', 'm', '', 'k', 'M', 'G', 'T'];
const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

const beyondSI = (exponent: number): boolean => {
  // Return whether the given exponent is beyond our SI prefixes.

  return exponent > 14 || exponent < -15;
};

const separateThousands = (text: string): string => {
  // Separate the thousands of the given (positive) number, if it has some decimals or more than four digits.

  const [integerPart = '', decimalPart] = text.split('.');
  let res = integerPart;

  if (decimalPart !== undefined || integerPart.length > 4) {
    while (/(\d+)(\d{3})/.test(res)) {
      res = res.replace(/(\d+)(\d{3})/, '$1,$2');
    }
  }

  return decimalPart === undefined ? res : `${res}.${decimalPart}`;
};

interface NumberFormat {
  tickRound: number; // Number of digits after the decimal point.
  exponent: number; // Common exponent (of an SI prefix), if any.
}

const MAX_NB_OF_SI_DECIMALS = 3; // Maximum number of decimals that a number with an SI prefix may need.

const numberFormat = (dtick: number, maxEnd: number): NumberFormat => {
  // Determine the format of our tick labels from our tick spacing and from the end of our axis that is the furthest
  // away from zero.
  // Note: unlike Plotly, we don't use an SI prefix if our number would then need more than a few decimals, which is the
  //       case when our tick spacing is small compared to our values (e.g., "1,000,000,000.2" rather than
  //       "1.0000000002B" when zoomed in on timestamps). We still use an exponent beyond our SI prefixes, though, since
  //       our numbers would otherwise be too long.

  const rangeExponent = Math.floor(Math.log10(maxEnd) + 0.01);
  const dtickExponent = Math.floor(Math.log10(dtick) + 0.01);
  let exponent = 0;

  if (Number.isFinite(rangeExponent) && Math.abs(rangeExponent) > 3) {
    if (beyondSI(rangeExponent)) {
      exponent = rangeExponent;
    } else {
      exponent = 3 * Math.round((rangeExponent - 1) / 3);

      if (exponent - dtickExponent > MAX_NB_OF_SI_DECIMALS) {
        exponent = 0;
      }
    }
  }

  return {
    tickRound: 2 - dtickExponent,
    exponent
  };
};

const formatNumber = (value: number, format: NumberFormat): string => {
  // The value is not finite, so we just return it as a string (e.g., 'NaN' or 'Infinity').

  if (!Number.isFinite(value)) {
    return String(value);
  }

  // A number that is (almost) zero is formatted as zero.

  let absValue = Math.abs(value);
  let tickRound = format.tickRound;

  if (absValue < 0.5 * 10 ** -tickRound) {
    return '0';
  }

  // Apply our exponent, if any.

  if (format.exponent) {
    absValue *= 10 ** -format.exponent;
    tickRound += format.exponent;
  }

  // Round our number and remove any trailing zeros.

  let res: string;

  if (tickRound === 0) {
    res = String(Math.round(absValue));
  } else if (tickRound < 0) {
    const magnitude = 10 ** -tickRound;

    res = String(Math.round(absValue / magnitude) * magnitude);
  } else {
    res = absValue.toFixed(Math.min(20, tickRound)).replace(/\.?0+$/, '');
  }

  // Determine whether our number is negative (we don't want to show a minus sign for zero).

  let isNegative = value < 0;

  if (res === '0') {
    isNegative = false;
  }

  // Separate our thousands and add our SI prefix or exponent, if any.

  res = separateThousands(res);

  if (format.exponent) {
    if (beyondSI(format.exponent)) {
      res += `×10${[...String(format.exponent)].map((character: string) => (character === '-' ? '⁻' : SUPERSCRIPT_DIGITS[Number(character)])).join('')}`;
    } else if (format.exponent === 9) {
      res += 'B';
    } else {
      res += SI_PREFIXES[format.exponent / 3 + 5] ?? '';
    }
  }

  // Add a minus sign if our number is negative.

  return isNegative ? MINUS_SIGN + res : res;
};

// Ticks, like Plotly, i.e. ticks that are multiples of a "nice" spacing, which depends on the length of our axis (see
// ticksUtils.ts). Unlike Plotly, though, we use fewer ticks if their labels would otherwise overlap (Plotly rotates its
// X tick labels instead and lets its Y tick labels overlap), and we don't have minor ticks (and therefore minor grid
// lines), so that our grid is lighter.

interface AxisTicks {
  label: (split: number) => string;
}

const axisTicks: Partial<Record<AxisKey, AxisTicks>> = {};

const logTickLabel = (value: number): string => {
  // Return the label of the given tick of a logarithmic axis, i.e. of a (multiple of a) power of ten, with only the
  // digits that it needs and its own SI prefix or exponent (e.g., "20μ", "0.5", "1", "1000", "10k", or "1×10¹⁵").

  const exponent = Math.floor(Math.log10(value) + 1e-9);

  return formatNumber(value, {
    tickRound: -exponent,
    exponent: Math.abs(exponent) > 3 ? (beyondSI(exponent) ? exponent : 3 * Math.floor(exponent / 3)) : 0
  });
};

const axisSplits = (axisKey: AxisKey): uPlot.Axis.Splits => {
  // Return a function that computes the splits (i.e. the positions of our ticks) for the given axis.

  return (u: uPlot, _axisIndex: number, min: number, max: number): number[] => {
    // Like Plotly, we aim for one tick every 80 (X axis) or 40 (Y axis) pixels with at least four and at most nine tick
    // spacings.

    const length = (axisKey === 'x' ? u.bbox.width : u.bbox.height) / uPlot.pxRatio;
    const minSpacing = axisKey === 'x' ? TICK_MIN_X_SPACING : TICK_MIN_Y_SPACING;
    const nbOfTicks = Math.min(Math.max(length / minSpacing, 4), 9) + 1;
    const range = Math.abs(max - min);
    const isLogAxis = logAxes.value[axisKey];

    // Make sure that our tick labels don't overlap, i.e. that the smallest distance between two consecutive ticks can
    // fit our biggest tick label along our axis (i.e. its width for our X axis and its height for our Y axis).
    // Note: the ticks of a logarithmic axis are not evenly spaced, hence we check all of them.

    const splitsFit = (splits: number[], label: (split: number) => string): boolean => {
      let labelSize = TICK_FONT_SIZE;

      if (axisKey === 'x') {
        labelSize = 0;

        for (const split of splits) {
          labelSize = Math.max(labelSize, textWidth(label(split), tickFont()));
        }
      }

      for (let i = 1; i < splits.length; ++i) {
        if (
          (length * ((splits[i] as number) - (splits[i - 1] as number))) / range <
          labelSize + TICK_LABEL_MIN_SPACING
        ) {
          return false;
        }
      }

      return true;
    };

    const setSplits = (splits: number[], label: (split: number) => string): number[] => {
      // Keep track of how to label our splits (see axisValues()) and return them.

      axisTicks[axisKey] = {
        label
      };

      return splits;
    };

    // A logarithmic axis that spans at least one power of ten has ticks at 1, 2, and 5 times each power of ten or, if
    // they don't fit, at every power of ten or at every 2, 5, 10, 20, etc. powers of ten. Otherwise (i.e. for a linear
    // axis or a logarithmic axis that spans less than a power of ten), we have "nice" linear ticks (between the actual
    // values of a logarithmic axis).
    // Note: we increase our tick spacing (to the next "nice" value) for as long as our tick labels would overlap. This
    //       always ends since we end up with at most one tick once our tick spacing is bigger than our range.

    if (isLogAxis && range >= 1 && Number.isFinite(range)) {
      const label = (split: number): string => logTickLabel(10 ** split);

      if (range <= nbOfTicks) {
        const splits: number[] = [];

        for (let exponent = Math.floor(min); exponent <= Math.ceil(max); ++exponent) {
          for (const mantissa of [1, 2, 5]) {
            const split = exponent + Math.log10(mantissa);

            if (split >= min - 1e-9 && split <= max + 1e-9) {
              splits.push(split);
            }
          }
        }

        if (splits.length <= nbOfTicks && splitsFit(splits, label)) {
          return setSplits(splits, label);
        }
      }

      let dtick = 1;

      for (;;) {
        const splits = ticksBetween(min, max, dtick);

        if (splits.length <= 1 || (splits.length <= nbOfTicks && splitsFit(splits, label))) {
          return setSplits(splits, label);
        }

        dtick = roundDTick(dtick);
      }
    }

    // Make sure that our tick spacing is valid, i.e. that our range is neither too small (e.g., a subnormal range, in
    // which case our tick spacing would be zero) nor too big (e.g., a range that overflows, in which case our tick
    // spacing would be infinite).

    const valueMin = isLogAxis ? 10 ** min : min;
    const valueMax = isLogAxis ? 10 ** max : max;
    const valueRange = Math.abs(valueMax - valueMin);
    const maxEnd = Math.max(Math.abs(valueMin), Math.abs(valueMax));
    let dtick = roundDTick(valueRange / nbOfTicks);

    if (!(dtick > 0 && Number.isFinite(dtick))) {
      return setSplits([], (split: number) => formatNumber(split, { tickRound: 0, exponent: 0 }));
    }

    for (;;) {
      const format = numberFormat(dtick, maxEnd);
      const label = (split: number): string => formatNumber(isLogAxis ? 10 ** split : split, format);
      const ticks = ticksBetween(valueMin, valueMax, dtick);
      const splits = isLogAxis ? ticks.filter((tick: number) => tick > 0).map(Math.log10) : ticks;

      if (splits.length <= 1 || splitsFit(splits, label)) {
        return setSplits(splits, label);
      }

      dtick = roundDTick(dtick);
    }
  };
};

const axisValues = (axisKey: AxisKey): uPlot.Axis.Values => {
  // Return a function that formats the tick labels for the given axis.

  return (u: uPlot, splits: number[]): string[] => {
    // Format our tick labels.
    // Note: our splits are computed (see axisSplits()) before our tick labels, so our labels are up to date.

    const label =
      axisTicks[axisKey]?.label ?? ((split: number): string => formatNumber(split, { tickRound: 0, exponent: 0 }));
    const plotTop = u.bbox.top / uPlot.pxRatio;
    const values = splits.map((split: number) => {
      // Like Plotly, hide a Y tick label that would (partly) be above our container.

      if (axisKey === 'y' && plotTop + u.valToPos(split, 'y') < TICK_LABEL_HALF_HEIGHT) {
        return '';
      }

      return label(split);
    });

    // Keep track of our tick labels, but give uPlot none to draw since we draw them ourselves (see drawTickLabels()).

    tickValues[axisKey] = values;

    return values.map(() => '');
  };
};

// Our tick labels, which we draw ourselves since uPlot positions them using their em box (e.g., it vertically centres a
// Y tick label's em box, rather than its digits, on its tick), which makes them look slightly off compared to Plotly's.

interface AxisInternals {
  _splits?: number[];
}

const tickValues: Record<AxisKey, string[]> = {
  x: [],
  y: []
};

interface TickLabel {
  text: string;
  x: number;
  y: number;
  align: 'center' | 'right';
}

const tickLabels = (u: uPlot, area: PathArea): TickLabel[] => {
  // Return our tick labels and where to draw them (in pixels of the given area), i.e. like Plotly, with their
  // alphabetic baseline X_TICK_LABEL_BASELINE pixels below our plotting area for our X axis and, for our Y axis,
  // Y_TICK_LABEL_GAP pixels to the left of our plotting area and with their alphabetic baseline Y_TICK_LABEL_BASELINE
  // pixels below their tick.
  // Note: like uPlot, we position our tick labels at whole pixels.

  const { left, top, width, height, xMin, xMax, yMin, yMax, pxRatio } = area;
  const bottom = top + height;
  const [xAxis, yAxis] = u.axes as unknown as AxisInternals[];
  const xLabelY = Math.round(bottom + X_TICK_LABEL_BASELINE * pxRatio);
  const yLabelX = Math.round(left) - Math.round(Y_TICK_LABEL_GAP * pxRatio);
  const res: TickLabel[] = [];

  xAxis?._splits?.forEach((split: number, index: number) => {
    const text = tickValues.x[index];

    if (text) {
      res.push({
        text,
        x: Math.round(left + ((split - xMin) * width) / (xMax - xMin)),
        y: xLabelY,
        align: 'center'
      });
    }
  });

  yAxis?._splits?.forEach((split: number, index: number) => {
    const text = tickValues.y[index];

    if (text) {
      res.push({
        text,
        x: yLabelX,
        y: Math.round(bottom - ((split - yMin) * height) / (yMax - yMin) + Y_TICK_LABEL_BASELINE * pxRatio),
        align: 'right'
      });
    }
  });

  return res;
};

const drawTickLabels = (u: uPlot): void => {
  // Make sure that we have a plotting area and that our axes have ranges, so that we can draw our tick labels.

  const area = pathArea(u);

  if (!area) {
    return;
  }

  // Draw our tick labels, using the same font as uPlot would (i.e. with a font size in whole canvas pixels).
  // Note: uPlot caches the state of its context, so we must restore it once we are done.

  const context = u.ctx;

  context.save();

  context.font = `${Math.round(TICK_FONT_SIZE * area.pxRatio)}px ${fontFamily}`;
  context.fillStyle = canvasColors.tickLabel;
  context.textBaseline = 'alphabetic';

  for (const tickLabel of tickLabels(u, area)) {
    context.textAlign = tickLabel.align;

    context.fillText(tickLabel.text, tickLabel.x, tickLabel.y);
  }

  context.restore();
};

// Text measuring, which we use to make sure that our X tick labels don't overlap, to size our Y axis and right margin,
// and to position the text in our exports.

let fontFamily = 'sans-serif';

const tickFont = (): string => {
  // Return the font of our tick labels, i.e. OpenCOR's font (see createPlot()) at TICK_FONT_SIZE pixels.

  return `${TICK_FONT_SIZE}px ${fontFamily}`;
};

let measureContext: CanvasRenderingContext2D | null | undefined;

const textWidth = (text: string, font: string): number => {
  // Return the width (in CSS pixels) of the given text using the given font.

  measureContext ??= document.createElement('canvas').getContext('2d');

  if (!measureContext) {
    return 0;
  }

  measureContext.font = font;

  return measureContext.measureText(text).width;
};

const fontAscent = (font: string): number => {
  // Return the ascent (in CSS pixels) of the given font, i.e. the distance between the top of its content area and its
  // alphabetic baseline.
  // Note: the ascent of a font doesn't depend on the text that we measure.

  measureContext ??= document.createElement('canvas').getContext('2d');

  if (!measureContext) {
    return 0;
  }

  measureContext.font = font;

  return measureContext.measureText('0').fontBoundingBoxAscent;
};

// Our Y axis size.

let naturalYAxisSize = 0;

const yAxisTitleSize = (): number => {
  // Return the size of our Y axis title, if any.

  return props.data.yAxisTitle ? Y_AXIS_TITLE_SIZE : 0;
};

const yAxisSize = (): number => {
  // Size our Y axis (without its title) based on the width of its widest tick label or, if we are given some shared
  // margins, based on the shared left margin (but never less than what we need).
  // Note: uPlot computes our tick labels (see axisValues()) before the size of our axis, so our Y tick labels are up to
  //       date.

  let maxWidth = 0;

  for (const value of tickValues.y) {
    maxWidth = Math.max(maxWidth, textWidth(value, tickFont()));
  }

  naturalYAxisSize = Math.ceil(maxWidth + Y_AXIS_EXTRA_SIZE);

  return props.margins ? Math.max(naturalYAxisSize, props.margins.left - yAxisTitleSize()) : naturalYAxisSize;
};

// Right margin, which we use to make sure that our legend and last X tick label are not cut off.

const legendRightMargin = (): number => {
  // Return the right margin needed by our legend (if any), with a margin on both sides of it (see legendLeft).
  // Note: this is our natural right margin, i.e. the right margin that we share with our sibling panels (see
  //       updateMarginsAsync()).

  return legendWidth ? Math.ceil(LEGEND_LEFT_MARGIN + legendWidth + LEGEND_RIGHT_MARGIN) : 0;
};

const rightMargin = (): number => {
  // Our right margin must leave room for our legend (or, if we are given some shared margins, for the shared right
  // margin) and for half our last X tick label (since it is centred on its tick), with a margin on its right side.
  // Note #1: our legend is to the right of our plotting area and no taller than it while our last X tick label is below
  //          our plotting area, so they can't overlap and our right margin only needs to fit the wider of the two. In
  //          practice, our last X tick label only matters when we don't have a legend (e.g., in the standard view or if
  //          we have no traces) since our legend is otherwise always wider than half our last X tick label. Also,
  //          unlike our legend, our last X tick label is not part of our shared right margin (see
  //          updateMarginsAsync()).
  // Note #2: uPlot computes our tick labels (see axisValues()) before our padding, so our last X tick label is up to
  //          date.

  const lastXValue = tickValues.x[tickValues.x.length - 1];
  const legendSize = props.margins ? Math.max(legendRightMargin(), props.margins.right) : legendRightMargin();
  const lastXTickLabelSize = lastXValue ? 0.5 * textWidth(lastXValue, tickFont()) + LEGEND_RIGHT_MARGIN : 0;

  return Math.ceil(Math.max(legendSize, lastXTickLabelSize));
};

// Update our margins asynchronously, i.e. after our plot has been laid out and we know how much space it needs for its
// axes and legend. This allows us to share our margins with other instances of PlotWidget, so that they can align their
// plots with ours.
// Note #1: we emit our natural margins (i.e. the margins that we need) whenever they change, and get given some shared
//          margins (i.e. the biggest natural margins of all our sibling panels), which we then use (see yAxisSize() and
//          rightMargin()).
// Note #2: our natural margins must not depend on our shared margins, or our sibling panels could keep adjusting to
//          each other's margins. Our natural left margin depends on our Y tick labels, i.e. on the height of our
//          plotting area, which doesn't depend on our shared margins. However, our last X tick label depends on our X
//          ticks, i.e. on the width of our plotting area, which does depend on our shared margins. So, our natural
//          right margin only accounts for our legend (see legendRightMargin()) and each panel makes room for its own
//          last X tick label (see rightMargin()). The (unlikely) cost is that a panel which last X tick label needs
//          more room than our shared right margin has a narrower plotting area than its sibling panels.

const sameMargins = (firstMargins: PlotMargins | undefined, secondMargins: PlotMargins | undefined): boolean => {
  return (
    firstMargins !== undefined &&
    secondMargins !== undefined &&
    firstMargins.left === secondMargins.left &&
    firstMargins.right === secondMargins.right
  );
};

const updateMarginsAsync = (): void => {
  // Coalesce multiple margin update requests into a single microtask.
  // Note: we use a microtask rather than an animation frame, so that our sibling panels (and ourselves) get relaid out
  //       using our new shared margins before the browser gets to paint us (e.g., while being resized). Otherwise, our
  //       sibling panels would be misaligned for one frame, i.e. they would flicker.

  if (marginsUpdatePending) {
    return;
  }

  marginsUpdatePending = true;

  queueMicrotask(() => {
    marginsUpdatePending = false;

    // Make sure that we have a plot and that it can be shown.

    if (!plot || isUnmounted || isPlotOutdated) {
      return;
    }

    // Emit our natural margins if they have changed.
    // Note: our natural right margin only accounts for our legend (see legendRightMargin()).

    const newMargins = {
      left: naturalYAxisSize + yAxisTitleSize(),
      right: legendRightMargin()
    };

    if (!sameMargins(newMargins, trackedMargins)) {
      trackedMargins = newMargins;

      emit('marginsUpdated', newMargins);
    }
  });
};

// Paths, which we build both for uPlot (in canvas pixels) and for our exports (in scaled pixels, see svgDocument()).

interface Path {
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  arc: (x: number, y: number, radius: number, startAngle: number, endAngle: number) => void;
}

interface PathArea extends PlotRect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  pxRatio: number;
}

const pathArea = (u: uPlot): PathArea | undefined => {
  // Make sure that we have a plotting area and that our axes have ranges, so that we can build paths in it.

  const xMin = u.scales.x?.min;
  const xMax = u.scales.x?.max;
  const yMin = u.scales.y?.min;
  const yMax = u.scales.y?.max;

  if (xMin == null || xMax == null || yMin == null || yMax == null) {
    return undefined;
  }

  // Return our plotting area in canvas pixels, so that we can build paths in it.

  return {
    ...u.bbox,
    xMin,
    xMax,
    yMin,
    yMax,
    pxRatio: uPlot.pxRatio
  };
};

// Grid lines.

const lineWidth = (pxRatio: number): number => {
  // Return the width (in pixels of the given pixel ratio, e.g., canvas pixels) of a one (CSS) pixel wide line.
  // Note: we make sure that it is at least one pixel wide (e.g., if our page is zoomed out a lot) since a canvas
  //       ignores a line width of zero, i.e. it would use whatever line width was used last.

  return Math.max(1, Math.round(pxRatio));
};

const linesPath = (
  path: Path,
  xValues: number[],
  yValues: number[],
  area: PathArea,
  withinPlottingArea: boolean = true
): void => {
  // Add crisp, one (CSS) pixel wide lines across our plotting area to the given path, i.e. vertical lines at the given
  // X values and horizontal lines at the given Y values, if they are within our plotting area (or regardless, if
  // requested).

  const { left, top, width, height, xMin, xMax, yMin, yMax } = area;
  const right = left + width;
  const bottom = top + height;
  const offset = 0.5 * (lineWidth(area.pxRatio) % 2);

  for (const xValue of xValues) {
    const xPos = Math.round(left + ((xValue - xMin) * width) / (xMax - xMin)) + offset;

    if (!withinPlottingArea || (xPos >= left && xPos <= right)) {
      path.moveTo(xPos, top);
      path.lineTo(xPos, bottom);
    }
  }

  for (const yValue of yValues) {
    const yPos = Math.round(bottom - ((yValue - yMin) * height) / (yMax - yMin)) + offset;

    if (!withinPlottingArea || (yPos >= top && yPos <= bottom)) {
      path.moveTo(left, yPos);
      path.lineTo(right, yPos);
    }
  }
};

const drawLines = (u: uPlot, color: string, xValues: number[], yValues: number[]): void => {
  // Make sure that we have a plotting area and that our axes have ranges, so that we can draw our lines.

  const area = pathArea(u);

  if (!area) {
    return;
  }

  // Draw our lines in canvas pixels, so that they are crisp and one (CSS) pixel wide.
  // Note: uPlot caches the state of its context, so we must restore it once we are done.

  const context = u.ctx;

  context.save();

  context.strokeStyle = color;
  context.lineWidth = lineWidth(area.pxRatio);

  context.beginPath();

  linesPath(context, xValues, yValues, area);

  context.stroke();
  context.restore();
};

const zeroLines = (axisKey: AxisKey): number[] => {
  // Return the zero line of the given axis, if it has one, i.e. if the axis is not logarithmic (since zero cannot be
  // plotted on a logarithmic axis, see plotValue()).

  return logAxes.value[axisKey] ? [] : [0];
};

const drawZeroLines = (u: uPlot): void => {
  // Like Plotly, draw our zero lines.
  // Note: this gets called after uPlot draws our grid lines and before it draws our traces.

  drawLines(u, canvasColors.zeroLine, zeroLines('x'), zeroLines('y'));
};

// Traces and markers.

const linearPath = (
  path: SimplifiedPath, // Always a SimplifiedPath, even if we don't simplify (see Note #4 of simplifiedPathUtils.ts).
  xValues: Float64Array,
  yValues: Float64Array,
  index0: number,
  index1: number,
  area: PathArea,
  lineWidth: number // In CSS pixels.
): void => {
  // uPlot doesn't support unsorted X values (e.g., phase plots) and draws each (canvas) pixel column of a dense trace
  // as a vertical line, which makes the steep parts of a trace look jagged. So, we use our own linear path builder
  // instead, both for uPlot and for our exports.
  // Note #1: for each set of consecutive points that are in the same pixel column (of our path), we only draw its
  //          first, minimum, maximum, and last points, in their original order and at their exact position (skipping
  //          any of them that is at the same position as the point drawn before it). This means that a smooth trace is
  //          drawn as is while the number of segments that we draw (and therefore the time it takes to draw them) is
  //          limited to four per set of consecutive points in a pixel column (e.g., with noisy data).
  // Note #2: we only ever look at consecutive points, so this works whether or not our X values are sorted.
  // Note #3: we break our path at non-finite values, so that a gap in the data is drawn as a gap in the trace.
  // Note #4: we skip any segment that is entirely outside our plotting area (e.g., when we are zoomed in), i.e. which
  //          two points are beyond the same edge of our plotting area (by more than the given line width since our
  //          traces are drawn with round joins and clipped to our plotting area, give or take half their line width, by
  //          uPlot and in our exports). This means that we only draw the part of our trace that can be seen.

  const { left, top, width, height, xMin, xMax, yMin, yMax } = area;
  const xFactor = width / (xMax - xMin);
  const yFactor = height / (yMax - yMin);
  const bottom = top + height;
  const right = left + width;
  const margin = lineWidth * area.pxRatio;

  // The edges beyond which a point is outside our plotting area (see Note #4 above).

  const outLeft = left - margin;
  const outRight = right + margin;
  const outTop = top - margin;
  const outBottom = bottom + margin;
  const end = Math.min(index1, xValues.length - 1, yValues.length - 1);
  let penDown = false;
  let hasPendingPoint = false;
  let pendingXPos = 0;
  let pendingYPos = 0;
  let previousOutCode = 0;
  let column = Number.NaN;
  let firstIndex = -1;
  let firstXPos = 0;
  let firstYPos = 0;
  let minIndex = -1;
  let minXPos = 0;
  let minYPos = 0;
  let maxIndex = -1;
  let maxXPos = 0;
  let maxYPos = 0;
  let lastIndex = -1;
  let lastXPos = 0;
  let lastYPos = 0;

  const drawColumn = (): void => {
    // Draw the minimum and maximum points of our current column (in their original order) unless they are its first
    // point (which we have already drawn) or its last point (which we draw last), and skipping any point that is at the
    // same position as the point drawn before it (since it would result in a zero-length segment).

    // If we don't have a first point, then we don't have a column to draw.

    if (firstIndex === -1) {
      return;
    }

    // Draw the minimum and maximum points of our current column in their original order.
    // Note: we don't use any helper function here since this gets called for (almost) every point of a noisy trace
    //       which X values are not sorted, and creating those functions every time would make linearPath() up to about
    //       twice as slow.

    const minIsFirst = minIndex < maxIndex;
    let drawnXPos = firstXPos;
    let drawnYPos = firstYPos;

    for (let k = 0; k < 2; ++k) {
      const index = (k === 0) === minIsFirst ? minIndex : maxIndex;

      if (index !== firstIndex && index !== lastIndex) {
        const xPos = index === minIndex ? minXPos : maxXPos;
        const yPos = index === minIndex ? minYPos : maxYPos;

        if (xPos !== drawnXPos || yPos !== drawnYPos) {
          path.lineTo(xPos, yPos);

          drawnXPos = xPos;
          drawnYPos = yPos;
        }
      }
    }

    // Draw the last point of our current column.

    if (lastIndex !== firstIndex && (lastXPos !== drawnXPos || lastYPos !== drawnYPos)) {
      path.lineTo(lastXPos, lastYPos);
    }

    // Reset our state so that we start a new column with the next point.

    firstIndex = -1;
  };

  // Process each point in our trace.

  for (let i = index0; i <= end; ++i) {
    // Make sure that our point has finite X and Y values.

    const x = xValues[i] as number;
    const y = yValues[i] as number;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      // Either our X or Y value is not finite, so draw our previous column, if any.

      drawColumn();

      // Reset our state so that we start a new path with the next point.

      penDown = false;
      hasPendingPoint = false;
      column = Number.NaN;

      continue;
    }

    // Convert our point to the coordinates of our path (i.e. canvas pixels for uPlot and scaled pixels for our
    // exports).

    const xPos = left + (x - xMin) * xFactor;
    const yPos = bottom - (y - yMin) * yFactor;
    const xPixel = Math.round(xPos);

    // Determine the edges of our plotting area (left, right, top, bottom) that our point is beyond, as a bit mask.
    // Note: we don't use a helper function here since this gets done for every point of our trace, and Chrome doesn't
    //       inline such a function (e.g., zooming 100 noisy traces of 1,000 points is then about 10% slower).

    const pointOutCode =
      (xPos < outLeft ? 1 : xPos > outRight ? 2 : 0) | (yPos < outTop ? 4 : yPos > outBottom ? 8 : 0);

    // Make sure that we have a previous point and that the segment between it and our current point may be visible. If
    // not, then we break our path and keep track of our current point, which may be the start of a visible segment.

    if (!(penDown || hasPendingPoint) || (previousOutCode & pointOutCode) !== 0) {
      if (penDown) {
        drawColumn();

        penDown = false;
        column = Number.NaN;
      }

      hasPendingPoint = true;
      pendingXPos = xPos;
      pendingYPos = yPos;
      previousOutCode = pointOutCode;

      continue;
    }

    // Start a new path from our pending point, if needed.

    if (!penDown) {
      path.moveTo(pendingXPos, pendingYPos);

      penDown = true;
      hasPendingPoint = false;
    }

    previousOutCode = pointOutCode;

    // If our point is in a different pixel column than the previous point, then draw the previous column and start a
    // new one.

    if (xPixel !== column) {
      // Draw our previous column, if any.

      drawColumn();

      // Draw our current point.
      // Note: our pen is always down at this stage (see above).

      path.lineTo(xPos, yPos);

      // Start a new column.

      column = xPixel;
      firstIndex = minIndex = maxIndex = lastIndex = i;
      firstXPos = minXPos = maxXPos = lastXPos = xPos;
      firstYPos = minYPos = maxYPos = lastYPos = yPos;

      continue;
    }

    // We are in the same column, so update our minimum and maximum points if needed.

    if (yPos < minYPos) {
      minIndex = i;
      minXPos = xPos;
      minYPos = yPos;
    } else if (yPos > maxYPos) {
      maxIndex = i;
      maxXPos = xPos;
      maxYPos = yPos;
    }

    // Update our last point to be our current point.

    lastIndex = i;
    lastXPos = xPos;
    lastYPos = yPos;
  }

  drawColumn();
};

// Level of detail.
// Note #1: linearPath() only draws the first, minimum, maximum, and last points of each pixel column, but it still has
//          to go through all the points of our trace to find them, i.e. it costs O(number of points). So, if the X
//          values of our trace are sorted and it has many more visible points than there are pixel columns, then we
//          first select those points using our level of detail (see levelOfDetailUtils.ts), which costs O(number of
//          pixel columns), and only give them to linearPath().
// Note #2: our columns are our pixel columns (i.e. those of linearPath()), so our selected points include all the
//          points that linearPath() would draw, i.e. our trace looks the same. The only exception is a pixel column in
//          which our trace goes beyond the top or bottom edge of our plotting area, since linearPath() then breaks our
//          path at points that we may not have selected, which may shift what gets drawn in that pixel column by a
//          fraction of a pixel.
// Note #3: we keep our level of detail up to date incrementally (see traceValues.ts).
// Note #4: the level of detail of a trace is shared with our hover (see hoveredIndex()), so that it doesn't need its
//          own (and therefore more memory). It keeps track of the values that it was last updated with (see Note #8 of
//          levelOfDetailUtils.ts), so each of its users only needs to update it with the values that it uses (see
//          updatedTraceLod()).
// Note #5: if the X values of our trace are not sorted (e.g., a phase plot), then linearPath() has to go through all of
//          its points. So, we first select the points that keep our trace within PATH_LOD_TOLERANCE canvas pixels of
//          what it would otherwise look like (along each axis) using our path level of detail (see
//          pathLevelOfDetailUtils.ts), and only give them to linearPath(). For a smooth trace, this means a few
//          thousand rather than millions of points, but not for a noisy trace (which our path level of detail can't
//          reduce, in which case we give all of its points to linearPath()).
// Note #6: linearPath() draws up to four points per pixel column, so a smooth trace which X values are sorted would get
//          drawn using thousands of segments, while a few hundred of them would make it look the same. So, unless its
//          points come from our path level of detail (which already simplifies it, see Note #5 and Note #7), we
//          simplify the path of our trace within SIMPLIFIED_PATH_TOLERANCE canvas pixels of what it would otherwise
//          look like (see simplifiedPathUtils.ts), since stroking a path costs about the same for each of its segments.
// Note #7: selecting the points of a trace which X values are sorted using our level of detail (see Note #1) costs
//          O(number of pixel columns), which is much more than what our path level of detail costs for a smooth trace
//          (e.g., about 0.2 ms rather than 0.01 ms per trace in Chrome). So, if our trace was smooth the last time that
//          we simplified its path (i.e. if its simplified path had at most SMOOTH_TRACE_RATIO times the number of
//          points that it would otherwise have had, see Note #6 and simplifiedPathUtils.ts), then we only go through
//          the points of our path level of detail that cover our visible points, if it has a level for our tolerance.
//          We don't do this for a trace that is not smooth (e.g., noisy data), since our path level of detail would
//          cost O(number of points) to find out that it can't reduce it (and again whenever its levels get rebuilt,
//          e.g., while a simulation is running). Neither do we do this for a trace whose points have changed since we
//          last built its path (other than its last point, see traceValues.ts), i.e. that has new points (e.g., while a
//          simulation is running) or new values (e.g., when plotting new data with the same number of points), since
//          our path level of detail would then have to process them (and be rebuilt for new values, or whenever the
//          range of its values gets bigger), while our (column) level of detail only selects the points of the columns
//          that they are in (see Note #6 of levelOfDetailUtils.ts).
// Note #8: simplifying the path of a trace that is not smooth (e.g., noisy data) hardly reduces its number of segments
//          while it costs some time (e.g., about 0.2 ms per noisy trace in Chrome), so we only simplify it every so
//          often, so that we still find out whether it has become smooth (e.g., once zoomed in, see TraceSmoothness in
//          simplifiedPathUtils.ts).
// Note #9: the level of our path level of detail that we need (see Note #7) costs O(number of points) to build the
//          first time (see Note #5 and Note #9 of pathLevelOfDetailUtils.ts), e.g. about 0.1 s for a trace of
//          10,000,000 points, i.e. about 1 s for ten such traces, which would freeze our plot (e.g., the first time
//          that we pan it, or when zooming in needs a finer level). So, we build it in the background, bit by bit (see
//          buildPathLevels()), and keep using our (column) level of detail until it is built. We stop building it if
//          the points of our trace change in the meantime (e.g., while a simulation is running), since we would only
//          use it once our trace gets drawn again with the same points.

const PATH_LOD_TOLERANCE = 0.25; // In canvas pixels, i.e. our traces are off by at most about 0.35 canvas pixels.
const SIMPLIFIED_PATH_TOLERANCE = 0.25; // In canvas pixels.
const SMOOTH_TRACE_RATIO = 0.25; // See Note #7 above.
const PATH_LEVEL_BUILD_POINTS = 65536; // Number of points that we go through at a time to build a path level.
const PATH_LEVEL_BUILD_TIME = 4; // Time (in milliseconds) after which we let the browser do something else (Note #9).

interface LinearPathPoints {
  xValues: Float64Array; // X values of the points to give to linearPath().
  yValues: Float64Array; // Y values of the points to give to linearPath().
  index0: number; // Index of the first point (included) to give to linearPath().
  index1: number; // Index of the last point (included) to give to linearPath().
  simplify: boolean; // Whether to simplify the path that linearPath() builds for our points (see Note #6 above).
}

const traceLods: levelOfDetailUtils.LevelOfDetail[] = [];
const pathLods: pathLevelOfDetailUtils.PathLevelOfDetail[] = [];
const traceSmoothnesses: TraceSmoothness[] = []; // Smoothness of our traces (see Note #7 and Note #8 above).

interface TracePoints {
  xValues: Float64Array; // X values of our trace.
  yValues: Float64Array; // Y values of our trace.
  count: number; // Number of points of our trace.
}

const tracePoints: TracePoints[] = []; // Points of our traces the last time that we built their path.

const traceSmoothness = (traceIndex: number): TraceSmoothness => {
  // Return the smoothness of the given trace, creating it if needed.

  traceSmoothnesses[traceIndex] ??= new TraceSmoothness();

  return traceSmoothnesses[traceIndex];
};

const updatedTraceLod = (
  traceIndex: number,
  xValues: Float64Array,
  yValues: Float64Array,
  count: number
): levelOfDetailUtils.LevelOfDetail => {
  // Return the level of detail of the given trace (creating it if needed), once updated for the given points (see Note
  // #4 above).

  traceLods[traceIndex] ??= levelOfDetailUtils.create();

  const lod = traceLods[traceIndex];

  levelOfDetailUtils.update(lod, xValues, yValues, count);

  return lod;
};

const pathLod = (traceIndex: number): pathLevelOfDetailUtils.PathLevelOfDetail => {
  // Return the path level of detail of the given trace, creating it if needed.

  pathLods[traceIndex] ??= pathLevelOfDetailUtils.create();

  return pathLods[traceIndex];
};

const pathLevelTolerances = (area: PathArea): [x: number, y: number] => {
  // Return the tolerances (in X and Y values) of the level of our path level of detail that we need for the given
  // plotting area (see Note #5 above).

  return [
    (PATH_LOD_TOLERANCE * (area.xMax - area.xMin)) / area.width,
    (PATH_LOD_TOLERANCE * (area.yMax - area.yMin)) / area.height
  ];
};

const selectedPathLevel = (
  traceIndex: number,
  xValues: Float64Array,
  yValues: Float64Array,
  count: number,
  area: PathArea
): pathLevelOfDetailUtils.PathLevel | undefined => {
  // Return the level of our path level of detail that keeps the given trace within our tolerance of what it would
  // otherwise look like in the given plotting area, if any (see Note #5 above), building it if needed.

  const lod = pathLod(traceIndex);
  const [xTolerance, yTolerance] = pathLevelTolerances(area);

  pathLevelOfDetailUtils.update(lod, xValues, yValues, count);

  return pathLevelOfDetailUtils.selectLevel(lod, xValues, yValues, xTolerance, yTolerance);
};

// The path levels that we are building in the background, by trace (see Note #9 above).

interface PathLevelBuild {
  xValues: Float64Array; // X values of our trace.
  yValues: Float64Array; // Y values of our trace.
  count: number; // Number of points of our trace.
  xTolerance: number; // Tolerances of the level that we need (see pathLevelTolerances()).
  yTolerance: number;
}

const pathLevelBuilds = new Map<number, PathLevelBuild>();
let pathLevelBuildsTimeoutId: ReturnType<typeof setTimeout> | undefined;

const builtPathLevel = (
  traceIndex: number,
  xValues: Float64Array,
  yValues: Float64Array,
  count: number,
  area: PathArea
): pathLevelOfDetailUtils.PathLevel | undefined => {
  // Return the level of our path level of detail that keeps the given trace within our tolerance of what it would
  // otherwise look like in the given plotting area, if any and if it is built, and otherwise have it built in the
  // background (see Note #9 above).

  const lod = pathLod(traceIndex);
  const [xTolerance, yTolerance] = pathLevelTolerances(area);

  if (pathLevelOfDetailUtils.buildLevel(lod, xValues, yValues, count, xTolerance, yTolerance, 0)) {
    return pathLevelOfDetailUtils.selectLevel(lod, xValues, yValues, xTolerance, yTolerance);
  }

  pathLevelBuilds.set(traceIndex, { xValues, yValues, count, xTolerance, yTolerance });

  pathLevelBuildsTimeoutId ??= setTimeout(buildPathLevels, common.NO_DELAY);

  return undefined;
};

const buildPathLevels = (): void => {
  // Build, bit by bit, the path levels that our traces need (see Note #9 above) for up to PATH_LEVEL_BUILD_TIME
  // milliseconds, and then let the browser do something else (e.g., draw a frame) before carrying on, if needed.

  pathLevelBuildsTimeoutId = undefined;

  const deadline = performance.now() + PATH_LEVEL_BUILD_TIME;

  for (const [traceIndex, build] of pathLevelBuilds) {
    if (performance.now() >= deadline) {
      break;
    }

    // Stop building the path level of a trace which points have changed since we were asked to build it (or which
    // doesn't get drawn using our level of detail anymore), since we only need it if our trace gets drawn again with
    // the same points (in which case we will be asked to build it again, see linearPathPoints()).

    const points = tracePoints[traceIndex];

    if (
      !props.levelOfDetail ||
      points?.xValues !== build.xValues ||
      points.yValues !== build.yValues ||
      points.count !== build.count
    ) {
      pathLevelBuilds.delete(traceIndex);

      continue;
    }

    // Build our path level until it is built or until we have to let the browser do something else.

    const lod = pathLod(traceIndex);
    let isBuilt = false;

    do {
      isBuilt = pathLevelOfDetailUtils.buildLevel(
        lod,
        build.xValues,
        build.yValues,
        build.count,
        build.xTolerance,
        build.yTolerance,
        PATH_LEVEL_BUILD_POINTS
      );
    } while (!isBuilt && performance.now() < deadline);

    if (isBuilt) {
      pathLevelBuilds.delete(traceIndex);
    }
  }

  if (pathLevelBuilds.size > 0) {
    pathLevelBuildsTimeoutId = setTimeout(buildPathLevels, common.NO_DELAY);
  }
};

const stopBuildingPathLevels = (): void => {
  // Stop building our path levels in the background, if we are.

  if (pathLevelBuildsTimeoutId !== undefined) {
    clearTimeout(pathLevelBuildsTimeoutId);

    pathLevelBuildsTimeoutId = undefined;
  }

  pathLevelBuilds.clear();
};

let selectionXValues = new Float64Array(0);
let selectionYValues = new Float64Array(0);

const selectionPoints = (
  xValues: Float64Array,
  yValues: Float64Array,
  indices: Int32Array,
  start: number,
  end: number,
  simplify: boolean
): LinearPathPoints => {
  // Return the points of the given trace which indices are from the given start (included) to the given end (excluded)
  // of the given indices, so that they can be given to linearPath().

  const nbOfPoints = end - start;

  if (selectionXValues.length < nbOfPoints) {
    selectionXValues = new Float64Array(indices.length);
    selectionYValues = new Float64Array(indices.length);
  }

  for (let i = 0; i < nbOfPoints; ++i) {
    const index = indices[start + i] as number;

    selectionXValues[i] = xValues[index] as number;
    selectionYValues[i] = yValues[index] as number;
  }

  return {
    xValues: selectionXValues,
    yValues: selectionYValues,
    index0: 0,
    index1: nbOfPoints - 1,
    simplify
  };
};

const linearPathPoints = (
  seriesIndex: number,
  xValues: Float64Array,
  yValues: Float64Array,
  index0: number,
  index1: number,
  area: PathArea
): LinearPathPoints => {
  // Return the points of the given trace that linearPath() needs to go through (see Note #1 above), i.e. all of them if
  // we are not to use our level of detail (see Note #3 of our props), in which case we don't simplify our path either
  // (so that our trace gets drawn as is, see Note #6 above).

  const res: LinearPathPoints = {
    xValues,
    yValues,
    index0,
    index1,
    simplify: props.levelOfDetail && traceSmoothness(seriesIndex - 1).simplifiesNextPath()
  };
  const count = Math.min(xValues.length, yValues.length);
  const previousPoints = tracePoints[seriesIndex - 1];
  const isUnchanged =
    previousPoints !== undefined &&
    previousPoints.count === count &&
    isContinuationOf(xValues, previousPoints.xValues) &&
    isContinuationOf(yValues, previousPoints.yValues);
  const nbOfColumns = Math.ceil(area.width) + 1;
  const minNbOfPoints = levelOfDetailUtils.MIN_POINTS_PER_COLUMN * nbOfColumns;
  const xFactor = area.width / (area.xMax - area.xMin);

  tracePoints[seriesIndex - 1] = { xValues, yValues, count };

  if (!props.levelOfDetail || count <= minNbOfPoints || !(xFactor > 0) || !Number.isFinite(xFactor)) {
    return res;
  }

  // Update our level of detail, from the first point that may have changed.

  const lod = updatedTraceLod(seriesIndex - 1, xValues, yValues, count);

  // Only go through the points that keep our trace within our tolerance of what it would otherwise look like, if our X
  // values are not sorted (see Note #5 above).

  if (lod.sortedLength < count) {
    const level = selectedPathLevel(seriesIndex - 1, xValues, yValues, count, area);

    return level ? selectionPoints(xValues, yValues, level.indices, 0, level.count, false) : res;
  }

  // Only go through our visible points, if our X values are sorted.
  // Note: linearPath() draws the points that are within its margin (i.e. the line width of our trace) of our plotting
  //       area, since part of what they draw can be seen, so we must go through them too.

  const margin = seriesLineWidth(seriesIndex) * area.pxRatio;
  const xMargin = margin / xFactor;
  const [start, end] = levelOfDetailUtils.visibleRange(
    lod,
    xValues,
    yValues,
    count,
    area.xMin - xMargin,
    area.xMax + xMargin
  );

  res.index0 = start;
  res.index1 = end - 1;

  // Only select the points that we go through, if we have many visible points.

  if (end - start <= minNbOfPoints) {
    return res;
  }

  const nbOfMarginColumns = Math.ceil(margin) + 1;
  const nbOfSelectionColumns = nbOfColumns + 2 * nbOfMarginColumns;

  // Only go through the points of our path level of detail that cover our visible points (see coveringRange() in
  // pathLevelOfDetailUtils.ts), if our trace was smooth the last time that we simplified it, if its points haven't
  // changed since we last built its path, if our path level of detail has a level that keeps our trace within our
  // tolerance (and it is built, see Note #9 above), and if that means going through fewer points than our (column)
  // level of detail could select, i.e. four per column (see Note #7 above).

  const level =
    traceSmoothnesses[seriesIndex - 1]?.isSmooth() && isUnchanged
      ? builtPathLevel(seriesIndex - 1, xValues, yValues, count, area)
      : undefined;

  if (level) {
    const [levelStart, levelEnd] = pathLevelOfDetailUtils.coveringRange(level, start, end);

    if (levelEnd - levelStart <= 4 * nbOfSelectionColumns) {
      return selectionPoints(xValues, yValues, level.indices, levelStart, levelEnd, false);
    }
  }

  // Otherwise, only go through the points that linearPath() would draw (see Note #1 above).
  // Note: linearPath() rounds the X position of a point to determine its pixel column, so our columns start half a
  //       pixel before the pixel column of the left edge of our plotting area, less the columns that cover the margin
  //       of linearPath() (and likewise after its right edge).

  const xMin = area.xMin + (Math.round(area.left) - 0.5 - area.left - nbOfMarginColumns) / xFactor;
  const xMax = xMin + nbOfSelectionColumns / xFactor;
  const selection = levelOfDetailUtils.selectPoints(
    lod,
    xValues,
    yValues,
    start,
    end,
    xMin,
    xMax,
    nbOfSelectionColumns
  );

  return selectionPoints(xValues, yValues, selection.indices, 0, selection.nbOfPoints, res.simplify);
};

// The number of points that we went through for each of our traces the last time that we built its path (see
// linearPaths() and pointCounts()).

const drawnPoints: number[] = [];

// Firefox's accelerated Canvas 2D (i.e. DrawTargetWebgl) needs some help to stroke our traces quickly.
// Note #1: Firefox only strokes a path on the GPU if it has no more than 4,000 points (see the
//          gfx.canvas.accelerated.gpu-path-complexity preference) and if the GPU data of its stroke fits in its buffer,
//          and otherwise rasterises it in software, which is very slow for a dense path (e.g., 135 ms rather than 6 ms
//          per frame for three noisy traces of 10,000 points). So, in Firefox, we split the path of a trace into paths
//          of at most FIREFOX_MAX_PATH_POINTS points (see chunkedPathUtils.ts), i.e. well below 4,000 points so that
//          the GPU data of their stroke also fits in its buffer.
// Note #2: Firefox stops accelerating a canvas if, for more than 30% of its frames, more than 66% of its draws needed
//          new GPU data (i.e. were "cache misses"), which is the case of every path that we stroke since our paths are
//          new every time that our plot gets drawn (e.g., while panning or zooming). So, with many traces (e.g., 100
//          noisy traces of 1,000 points), our canvas would stop being accelerated, i.e. would get drawn in software,
//          which is many times slower (e.g., 630 ms rather than 20 ms per frame). To prevent this, we fill a
//          transparent pixel for each path that we stroke, which Firefox counts as a draw that needs no new GPU data,
//          while it draws nothing.

const FIREFOX_MAX_PATH_POINTS = 2000; // See Note #1 above.

const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox/');

let nbOfStrokedPaths = 0; // Number of paths that we have built since our plot was last drawn (see Note #2 above).

const fillTransparentPixels = (u: uPlot): void => {
  // Fill a transparent pixel for each path that we have built since our plot was last drawn, if we are in Firefox (see
  // Note #2 above).
  // Note: this gets called once our traces have been drawn (see the draw hook in createPlot()), and uPlot caches the
  //       state of its context, so we must restore it once we are done.

  if (!isFirefox || !nbOfStrokedPaths) {
    return;
  }

  const context = u.ctx;

  context.save();

  context.fillStyle = 'transparent';

  for (let i = 0; i < nbOfStrokedPaths; ++i) {
    context.fillRect(0, 0, 1, 1);
  }

  context.restore();

  nbOfStrokedPaths = 0;
};

class SameStylePaths extends Map<string, Path2D> {
  // Some paths that uPlot strokes one after the other, using the same style. Indeed, uPlot strokes each path of a map
  // using its key as its style (see doStroke() in uPlot), i.e. a map would otherwise only allow one path per style.

  private readonly style: string;
  private readonly paths: Path2D[];

  constructor(style: string, paths: Path2D[]) {
    super();

    this.style = style;
    this.paths = paths;
  }

  override forEach(callback: (path: Path2D, style: string, map: Map<string, Path2D>) => void): void {
    for (const path of this.paths) {
      callback(path, this.style, this);
    }
  }
}

const linearPaths: uPlot.Series.PathBuilder = (u: uPlot, seriesIndex: number, index0: number, index1: number) => {
  // Use our linear path builder for our trace (see linearPath()), and our level of detail (see linearPathPoints()),
  // keeping track of the number of points that we go through, and simplify our path, if needed (see Note #6 of our
  // level of detail). Also, split our path into several paths, if needed (see chunkedPathUtils.ts and, for Firefox,
  // above).
  // Note: linearPath() draws each of the points that it goes through at most once, so our path may only have more than
  //       a given number of points if we go through more than that.

  const [xValues, yValues] = seriesData(u, seriesIndex) ?? [];
  const area = pathArea(u);
  let strokes: Path2D[] = [];
  let nbOfDrawnPoints = 0;

  if (xValues && yValues && area) {
    const points = linearPathPoints(seriesIndex, xValues, yValues, index0, index1, area);
    const lastIndex = Math.min(points.index1, points.xValues.length - 1, points.yValues.length - 1);
    const maxPathPoints = isFirefox ? FIREFOX_MAX_PATH_POINTS : MAX_PATH_POINTS;

    nbOfDrawnPoints = Math.max(0, lastIndex - points.index0 + 1);

    const stroke =
      nbOfDrawnPoints > maxPathPoints ? createChunkedPath(() => new Path2D(), maxPathPoints) : new Path2D();
    const simplifiedPath = new SimplifiedPath(
      stroke,
      points.simplify ? SIMPLIFIED_PATH_TOLERANCE : 0,
      SMOOTH_TRACE_RATIO * nbOfDrawnPoints
    );

    linearPath(
      simplifiedPath,
      points.xValues,
      points.yValues,
      points.index0,
      points.index1,
      area,
      seriesLineWidth(seriesIndex)
    );

    simplifiedPath.end();

    // Keep track of whether our trace is smooth (see Note #7 and Note #8 of our level of detail).

    traceSmoothness(seriesIndex - 1).update(simplifiedPath, SMOOTH_TRACE_RATIO);

    strokes = stroke instanceof Path2D ? [stroke] : stroke.paths;
    nbOfStrokedPaths += strokes.length;
  }

  drawnPoints[seriesIndex - 1] = nbOfDrawnPoints;

  // Use the line width and dash pattern of our trace, which may have changed since our plot was created (e.g., if we
  // were given new data with the same number of traces, see updatePlot()).
  // Note: uPlot strokes our path or paths using the line width and dash pattern of our series, once we have built them.
  //       It scales our line width by our pixel ratio, but uses our dash pattern as is, hence we scale it ourselves.

  const plotSeries = u.series[seriesIndex];

  if (plotSeries) {
    plotSeries.width = seriesLineWidth(seriesIndex);
    plotSeries.dash = seriesLineDash(seriesIndex).map((length: number) => length * uPlot.pxRatio);
  }

  // Stroke our path or paths.

  return {
    stroke: strokes.length > 1 ? new SameStylePaths(seriesColor(seriesIndex), strokes) : (strokes[0] ?? null),
    fill: null,
    clip: null,
    flags: 0
  };
};

const markerPath = (path: Path, xValues: Float64Array, yValues: Float64Array, area: PathArea): void => {
  // Like Plotly, draw a marker for each point of our trace that has finite X and Y values.

  const { left, top, width, height, xMin, xMax, yMin, yMax } = area;
  const xFactor = width / (xMax - xMin);
  const yFactor = height / (yMax - yMin);
  const bottom = top + height;
  const radius = 0.5 * MARKER_SIZE * area.pxRatio;
  const nbOfPoints = Math.min(xValues.length, yValues.length);

  for (let i = 0; i < nbOfPoints; ++i) {
    const x = xValues[i] as number;
    const y = yValues[i] as number;

    if (Number.isFinite(x) && Number.isFinite(y)) {
      const xPos = left + (x - xMin) * xFactor;
      const yPos = bottom - (y - yMin) * yFactor;

      path.moveTo(xPos + radius, yPos);
      path.arc(xPos, yPos, radius, 0, 2 * Math.PI);
    }
  }
};

const markerPaths: uPlot.Series.Points.PathBuilder = (u: uPlot, seriesIndex: number) => {
  // Use our markers path builder for our trace (see markerPath()), clipping our markers to our plotting area.
  // Note: uPlot's markers path builder clips our markers to our plotting area extended by a marker's diameter on each
  //       side, i.e. our markers could be drawn over our axes, hence we use our own.

  const [xValues, yValues] = seriesData(u, seriesIndex) ?? [];
  const area = pathArea(u);
  const fill = new Path2D();
  const clip = new Path2D();
  const { left, top, width, height } = u.bbox;

  clip.rect(left, top, width, height);

  if (xValues && yValues && area) {
    markerPath(fill, xValues, yValues, area);
  }

  return { stroke: null, fill, clip, flags: 0 };
};

const forgetRemovedTraces = (nbOfTraces: number): void => {
  // Forget about the levels of detail, smoothness, hover searches, and drawn points of the traces that we don't have
  // anymore (e.g., if our data now has fewer traces, or none at all), so that they don't keep using memory (and a
  // reference to our old data).
  // Note: this gets called whenever our data gets updated (see plotData()).

  for (const array of [pathLods, traceLods, traceSmoothnesses, tracePoints, hoverSearches, drawnPoints]) {
    if (array.length > nbOfTraces) {
      array.length = nbOfTraces;
    }
  }
};

// The last point of our visible traces when our data is live (e.g., while a simulation is running), which is shown
// using an overlay (see PlotLivePointsWidget.vue).
// Note: our live points are updated whenever our plot gets drawn (e.g., when our data gets updated, when we zoom
//       in/out, or when a trace gets highlighted), and our exports are not affected (which is what we want since they
//       are only a visual aid). The last point of a trace is its last point with finite X and Y values, if any.

const livePointsRef = vue.useTemplateRef<InstanceType<typeof PlotLivePointsWidget>>('livePointsRef');

const updateLivePoints = (u: uPlot | undefined): void => {
  // Determine the position (in CSS pixels, relative to our plotting area) of the last point of our visible traces, if
  // our data is live.

  if (!props.live || !u) {
    livePointsRef.value?.setPoints(plotRect.value, []);

    return;
  }

  const newLivePoints: PlotLivePoint[] = [];

  for (let seriesIndex = 1; seriesIndex < u.series.length; ++seriesIndex) {
    // Make sure that our trace is visible and that it has some data.

    const [xValues, yValues] = seriesData(u, seriesIndex) ?? [];
    const color = props.data.traces[seriesIndex - 1]?.color;

    if (!u.series[seriesIndex]?.show || !xValues || !yValues || !color) {
      continue;
    }

    // Find the last point of our trace that has finite X and Y values, if any.

    let i = Math.min(xValues.length, yValues.length) - 1;

    while (i >= 0 && !(Number.isFinite(xValues[i]) && Number.isFinite(yValues[i]))) {
      --i;
    }

    if (i < 0) {
      continue;
    }

    // Convert the last point of our trace to the coordinates of our plotting area (in CSS pixels).

    const x = u.valToPos(xValues[i] as number, 'x');
    const y = u.valToPos(yValues[i] as number, 'y');

    if (Number.isFinite(x) && Number.isFinite(y)) {
      newLivePoints.push({ x, y, color, alpha: seriesAlpha(seriesIndex - 1) });
    }
  }

  livePointsRef.value?.setPoints(plotRect.value, newLivePoints);
};

const setPlotSize = (u: uPlot, width: number, height: number): void => {
  // Set the size of our plot.
  // Note: if some of our visible traces have markers, then our autorange depends on the length of our axes (since the
  //       padding for markers is in pixels), so we need to autorange our axes again, which we do by resetting our data.

  u.batch(() => {
    u.setSize({ width, height });

    if (anyMarkers(u)) {
      u.setData(u.data);
    }
  });
};

// Hover functionality, i.e. a tooltip that lists the value of each of our visible traces at the X value that is under
// the mouse pointer (like Plotly's 'x unified' hover mode), with a vertical guide line at that X value and the
// corresponding points of our traces highlighted.
// Note: a trace which X values are not sorted (e.g., a phase plot) doesn't have one value per X value, so we use its
//       point that is closest to the mouse pointer instead (like Plotly's 'closest' hover mode).

interface HoverPoint {
  seriesIndex: number;
  x: number;
  y: number;
  color: string;
}

interface HoverRow {
  seriesIndex: number;
  name: string;
  value: string;
  color: string;
}

interface Hover {
  clientX: number;
  clientY: number;
  guideX: number;
  guideWidth: number;
  points: HoverPoint[];
  x: string;
  rows: HoverRow[];
  otherRows: number;
}

const hover = vue.shallowRef<Hover | null>(null);
let hoverRafId: number | undefined;

const formatHoverValue = (value: number): string => {
  // Like Plotly, format a value in our hover tooltip using the value itself as the tick spacing and adding four digits
  // of precision.

  const absValue = Math.abs(value) || 1;
  const format = numberFormat(absValue, absValue);

  return formatNumber(value, {
    ...format,
    tickRound: format.tickRound + 4
  });
};

// The last search for the hovered point of each of our traces which X values are not sorted (see hoveredIndex()), so
// that if we search again with the same mouse pointer, radius, and plotting area (e.g., while a simulation is running),
// and for a continuation of the same values (see traceValues.ts), then we only need to look at the new points.

interface HoverSearch {
  xValues: Float64Array;
  yValues: Float64Array;
  nbOfPoints: number;
  left: number;
  top: number;
  radius: number;
  area: PathArea;
  index: number; // Index of the closest point, or -1 if there is none.
  distance: number; // Its distance from the mouse pointer (or HOVER_DISTANCE if there is no closest point).
}

const hoverSearches: (HoverSearch | undefined)[] = [];

const hoveredIndex = (
  traceIndex: number,
  xValues: Float64Array,
  yValues: Float64Array,
  left: number,
  top: number,
  radius: number,
  area: PathArea
): number => {
  // Return the index of the point of the given trace that gets hovered, if any, i.e. the finite point which X value is
  // the closest to the mouse pointer (within HOVER_DISTANCE pixels) if the X values of its finite points are sorted
  // (see Note #7 of levelOfDetailUtils.ts), or its finite point that is the closest to the mouse pointer (within
  // HOVER_DISTANCE pixels) otherwise.
  // Note: like Plotly (see its scatter hoverPoints() and Fx.getClosest()), the distance between the mouse pointer and a
  //       point is reduced by the "radius" of the point (i.e. the radius of its marker, if any, or HOVER_LINE_RADIUS
  //       pixels otherwise), with points within that radius being at a distance of zero. Also, in case of a tie, the
  //       last point wins, so that a point that is drawn on top of another one gets hovered.

  const { width, height, xMin, xMax, yMin, yMax } = area;
  const xFactor = width / (xMax - xMin);
  const yFactor = height / (yMax - yMin);
  const nbOfPoints = Math.min(xValues.length, yValues.length);
  let res = -1;
  let closestDistance = HOVER_DISTANCE;

  const lod = updatedTraceLod(traceIndex, xValues, yValues, nbOfPoints);

  if (lod.sortedLength === nbOfPoints) {
    // Look at the finite points on either side of the X value that is under the mouse pointer, skipping any gap between
    // them and that X value (using our level of detail, so that it costs O(log(number of points))).

    for (const i of levelOfDetailUtils.neighbouringPoints(lod, xValues, yValues, nbOfPoints, xMin + left / xFactor)) {
      if (i < 0 || i >= nbOfPoints) {
        continue;
      }

      const distance = Math.max(Math.abs(((xValues[i] as number) - xMin) * xFactor - left) - radius, 0);

      if (distance <= closestDistance) {
        res = i;
        closestDistance = distance;
      }
    }

    return res;
  }

  // Look at all the points of our trace or, if we can carry on from our previous search (see HoverSearch), only at its
  // points from the last point of our previous search (which may have changed), unless it was our closest point (in
  // which case we don't know which of our other points would be the closest one).

  const previous = hoverSearches[traceIndex];
  let from = 0;

  if (
    previous &&
    previous.left === left &&
    previous.top === top &&
    previous.radius === radius &&
    previous.area.width === width &&
    previous.area.height === height &&
    previous.area.xMin === xMin &&
    previous.area.xMax === xMax &&
    previous.area.yMin === yMin &&
    previous.area.yMax === yMax &&
    isContinuationOf(xValues, previous.xValues) &&
    isContinuationOf(yValues, previous.yValues) &&
    previous.index < previous.nbOfPoints - 1
  ) {
    from = Math.max(0, previous.nbOfPoints - 1);
    res = previous.index;
    closestDistance = previous.distance;
  }

  for (let i = from; i < nbOfPoints; ++i) {
    // Skip our point if its horizontal distance (less its radius) is greater than the distance of the closest point so
    // far (or than HOVER_DISTANCE pixels if we haven't found one yet), in which case it can't be as close to the mouse
    // pointer.
    // Note: we negate our comparison so that a point with a NaN X value gets skipped.

    const dx = ((xValues[i] as number) - xMin) * xFactor - left;

    if (!(Math.abs(dx) - radius <= closestDistance)) {
      continue;
    }

    // Keep track of our point if it is at least as close to the mouse pointer as the closest point so far (so that, in
    // case of a tie, the last point wins).
    // Note: a point with a NaN Y value gets skipped since its distance is NaN.

    const dy = height - ((yValues[i] as number) - yMin) * yFactor - top;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy) - radius, 0);

    if (distance <= closestDistance) {
      res = i;
      closestDistance = distance;
    }
  }

  hoverSearches[traceIndex] = {
    xValues,
    yValues,
    nbOfPoints,
    left,
    top,
    radius,
    area,
    index: res,
    distance: closestDistance
  };

  return res;
};

const updateHover = (): void => {
  // Make sure that we have a plot, that the mouse pointer is over our plotting area, and that we are not dragging.

  const u = plot;
  const rect = plotRect.value;
  const mainDiv = mainDivRef.value;
  const left = u?.cursor.left;
  const top = u?.cursor.top;
  const area = u ? pathArea(u) : undefined;

  if (!u || !rect || !mainDiv || !area || drag || left == null || top == null || left < 0 || top < 0) {
    hover.value = null;

    return;
  }

  // Determine the point of each of our visible traces that gets hovered, if any, and the X value of the one that is the
  // closest to the mouse pointer (horizontally), which is the X value that we show in our hover tooltip.
  // Note: we use our plotting area in CSS pixels (since the position of the mouse pointer is in CSS pixels).

  const cssArea: PathArea = { ...area, ...rect, pxRatio: 1 };
  const xFactor = cssArea.width / (cssArea.xMax - cssArea.xMin);
  const yFactor = cssArea.height / (cssArea.yMax - cssArea.yMin);
  const hoveredIndices = new Map<number, number>();
  let xValue = Number.NaN;
  let xDistance = Number.POSITIVE_INFINITY;

  for (let seriesIndex = 1; seriesIndex < u.series.length; ++seriesIndex) {
    // Make sure that our series is visible and that it has data.

    const [xValues, yValues] = seriesData(u, seriesIndex) ?? [];

    if (!u.series[seriesIndex]?.show || !xValues || !yValues) {
      continue;
    }

    // Determine the point of our series that gets hovered, if any.

    const radius = seriesHasMarkers(u, seriesIndex) ? 0.5 * MARKER_SIZE : HOVER_LINE_RADIUS;
    const index = hoveredIndex(seriesIndex - 1, xValues, yValues, left, top, radius, cssArea);

    if (index !== -1) {
      const x = xValues[index] as number;
      const distance = Math.abs((x - cssArea.xMin) * xFactor - left);

      hoveredIndices.set(seriesIndex, index);

      if (distance < xDistance) {
        xValue = x;
        xDistance = distance;
      }
    }
  }

  // Make sure that some points get hovered, and hide our hover tooltip if none do.

  if (!hoveredIndices.size) {
    hover.value = null;

    return;
  }

  // Build our hover tooltip, listing our traces in the order of our legend, and highlight the hovered points that are
  // within our plotting area.

  const points: HoverPoint[] = [];
  const rows: HoverRow[] = [];

  for (const legendItem of legendItems.value) {
    const seriesIndex = legendItem.index + 1;
    const index = hoveredIndices.get(seriesIndex);
    const [xValues, yValues] = seriesData(u, seriesIndex) ?? [];

    if (index === undefined || !xValues || !yValues) {
      continue;
    }

    const x = ((xValues[index] as number) - cssArea.xMin) * xFactor;
    const y = cssArea.height - ((yValues[index] as number) - cssArea.yMin) * yFactor;

    if (x >= 0 && x <= cssArea.width && y >= 0 && y <= cssArea.height) {
      points.push({ seriesIndex, x, y, color: legendItem.color });
    }

    rows.push({
      seriesIndex,
      name: legendItem.name,
      value: formatHoverValue(actualValue('y', yValues[index] as number)),
      color: legendItem.color
    });
  }

  // Show our hover tooltip at the mouse pointer (in CSS pixels) and our guide line at our X value.
  // Note: like our grid and zero lines (see linesPath()), our guide line is snapped to whole device pixels and is a
  //       whole number of device pixels wide (see lineWidth()), so that it is crisp whatever our pixel ratio.

  const mainDivRect = mainDiv.getBoundingClientRect();
  const pxRatio = uPlot.pxRatio;
  const guideWidth = lineWidth(pxRatio);

  if (!hover.value) {
    updateOverlayThemeStyle();
  }

  hover.value = {
    clientX: mainDivRect.left + rect.left + left,
    clientY: mainDivRect.top + rect.top + top,
    guideX: (Math.round((xValue - cssArea.xMin) * xFactor * pxRatio) + 0.5 * (guideWidth % 2)) / pxRatio,
    guideWidth: guideWidth / pxRatio,
    points,
    x: formatHoverValue(actualValue('x', xValue)),
    rows: rows.slice(0, HOVER_TOOLTIP_MAX_ROWS),
    otherRows: Math.max(0, rows.length - HOVER_TOOLTIP_MAX_ROWS)
  };

  // Position our hover tooltip once it has been rendered (since its position depends on its size).

  void vue.nextTick().then(placeHoverTooltip);
};

const placeHoverTooltip = (): void => {
  // Make sure that our hover tooltip has been rendered and that we are still hovering.

  const tooltip = hoverTooltipRef.value;
  const currentHover = hover.value;

  if (!tooltip || !currentHover) {
    return;
  }

  // Place our hover tooltip to the right of the mouse pointer or, if there isn't enough room for it, to its left, and
  // vertically centred on it, while keeping it within the window.

  const { width, height } = tooltip.getBoundingClientRect();
  const rightLeft = currentHover.clientX + HOVER_TOOLTIP_OFFSET;
  const left =
    rightLeft + width + HOVER_TOOLTIP_MARGIN <= window.innerWidth
      ? rightLeft
      : currentHover.clientX - HOVER_TOOLTIP_OFFSET - width;
  const top = Math.min(
    Math.max(currentHover.clientY - 0.5 * height, HOVER_TOOLTIP_MARGIN),
    window.innerHeight - height - HOVER_TOOLTIP_MARGIN
  );

  tooltip.style.left = `${Math.max(left, HOVER_TOOLTIP_MARGIN)}px`;
  tooltip.style.top = `${top}px`;
};

const queueHoverUpdate = (): void => {
  // Coalesce multiple hover update requests into a single common.requestFrame() callback.

  if (hoverRafId !== undefined) {
    return;
  }

  hoverRafId = common.requestFrame(() => {
    hoverRafId = undefined;

    updateHover();
  });
};

// Logarithmic axes.
// Note: rather than use a logarithmic scale for a logarithmic axis (in which case all our range computations, e.g., to
//       autorange, zoom, pan, or pinch, would have to be done in logarithmic space), we plot the decimal logarithm of
//       its values (with a non-positive value becoming NaN, i.e. not being plotted), so that everything remains linear.
//       So, the range of a logarithmic axis is the decimal logarithm of its actual range, and only what we are given
//       (i.e. the ranges of our axes, see naturalRange()) and what we show (i.e. our tick labels, hover tooltip, and
//       range editor) needs to be converted from/to actual values (see plotValue() and actualValue()). Our image
//       exports are of what we plot, so they are fine too, and our CSV export is of our actual data.

const plotValue = (axisKey: AxisKey, value: number): number => {
  // Return the value that we plot for the given actual value along the given axis.

  if (!logAxes.value[axisKey]) {
    return value;
  }

  return value > 0 ? Math.log10(value) : Number.NaN;
};

const actualValue = (axisKey: AxisKey, value: number): number => {
  // Return the actual value of the given plotted value along the given axis.

  return logAxes.value[axisKey] ? 10 ** value : value;
};

// The values that we plot for our traces, i.e. their actual values or, along a logarithmic axis, their decimal
// logarithm, as well as the statistics of those values (i.e. their range).
// Note #1: our data gets updated whenever new data is given to us (e.g., many times a second while a simulation is
//          running), typically with a few more values each time, so we process our values incrementally (see
//          traceValues.ts), i.e. updating a trace with N new values costs O(N) rather than O(number of values).
// Note #2: our traces may share their values (e.g., their X values), so we keep track of the values that we plot per
//          array of actual values (identified by its buffer, offset, and length) rather than per trace. This means that
//          shared values only get processed once and that their logarithm only gets computed (and stored) once. An
//          array that is a continuation of one that we processed the last time our data got updated (see
//          traceValues.ts) carries on from it, unless another array has already done so (e.g., if two of our traces
//          have values of different lengths from the same buffer and offset), in which case it gets processed from
//          scratch, so that each array gets what it should. Also, we only keep track of the arrays that we are
//          plotting, so that we don't keep the logarithm of values that we don't plot anymore.

interface PlottedAxisValues {
  source: Float64Array | undefined; // The actual values that we last processed.
  values: Float64Array; // The values that we plot for them.
  log: LogValues | undefined; // The decimal logarithm of our actual values, if our axis is logarithmic.
  statistics: ValuesStatistics | undefined; // The statistics of the values that we plot.
}

type PlottedValues = Record<AxisKey, PlottedAxisValues>;
type PlottedArrays = Map<ArrayBufferLike, Map<number, PlottedAxisValues[]>>; // By buffer and then by offset.

let plottedValues: PlottedValues[] = []; // The values that we plot for each of our traces.
let plottedArrays: Record<AxisKey, PlottedArrays> = { x: new Map(), y: new Map() }; // See Note #2 above.

const plotValues = (
  axisKey: AxisKey,
  values: Float64Array,
  previousArrays: PlottedArrays,
  arrays: PlottedArrays
): PlottedAxisValues => {
  // Return the values that we plot for the given actual values along the given axis, keeping track of them and of their
  // statistics (see Note #2 above).

  let arrayValues = arrays.get(values.buffer);

  if (!arrayValues) {
    arrayValues = new Map();

    arrays.set(values.buffer, arrayValues);
  }

  let offsetValues = arrayValues.get(values.byteOffset);

  if (!offsetValues) {
    offsetValues = [];

    arrayValues.set(values.byteOffset, offsetValues);
  }

  // Reuse what we have already done for the given values, if they have already been processed (i.e. if another of our
  // traces shares them, i.e. has values from the same buffer, offset, and of the same length).

  const processedValues = offsetValues.find((plotted: PlottedAxisValues) => plotted.source?.length === values.length);

  if (processedValues) {
    return processedValues;
  }

  // Carry on from what we did the last time our data got updated for the longest values of which the given values are a
  // continuation, if any and if no other values have already done so, or start from scratch (see Note #2 above).

  let res: PlottedAxisValues | undefined;

  for (const plotted of previousArrays.get(values.buffer)?.get(values.byteOffset) ?? []) {
    if (
      (plotted.source?.length ?? 0) <= values.length &&
      (plotted.source?.length ?? 0) > (res?.source?.length ?? -1) &&
      !offsetValues.includes(plotted)
    ) {
      res = plotted;
    }
  }

  res ??= {
    source: undefined,
    values,
    log: undefined,
    statistics: undefined
  };

  if (logAxes.value[axisKey]) {
    res.log = logValues(values, res.log);
    res.values = res.log.values;
  } else {
    res.log = undefined;
    res.values = values;
  }

  res.source = values;
  res.statistics = valuesStatistics(res.values, res.statistics);

  offsetValues.push(res);

  return res;
};

const plotData = (): uPlot.AlignedData => {
  // Return the data to be plotted, i.e. the values that we plot for our traces (see plotValues()), forgetting about the
  // traces that we don't have anymore (see forgetRemovedTraces()).
  // Note: uPlot needs at least one series, hence we use an empty one if we have no traces.

  forgetRemovedTraces(props.data.traces.length);

  const arrays: Record<AxisKey, PlottedArrays> = { x: new Map(), y: new Map() };

  plottedValues = props.data.traces.map(
    (trace: PlotTrace): PlottedValues => ({
      x: plotValues('x', trace.x, plottedArrays.x, arrays.x),
      y: plotValues('y', trace.y, plottedArrays.y, arrays.y)
    })
  );
  plottedArrays = arrays;

  const data = plottedValues.map((plotted: PlottedValues) => [plotted.x.values, plotted.y.values]);

  return [
    null,
    ...(data.length ? data : [[common.EMPTY_FLOAT64_ARRAY, common.EMPTY_FLOAT64_ARRAY]])
  ] as unknown as uPlot.AlignedData;
};

const createPlot = (width: number, height: number): void => {
  // Destroy any existing plot before creating a new one.

  plot?.destroy();

  // Use OpenCOR's font, i.e. the one that we inherit, for what gets drawn on uPlot's canvas (and measured using
  // textWidth()), so that it is consistent with our axis titles and legend (and the rest of OpenCOR).

  if (mainDivRef.value) {
    fontFamily = getComputedStyle(mainDivRef.value).fontFamily;
  }

  // Create a series for each trace, using the trace's colour for the stroke, our linear path builder, and our markers
  // path builder (for traces with markers).

  const series: uPlot.Series[] = [{}];

  for (let i = 0; i < Math.max(1, props.data.traces.length); ++i) {
    series.push({
      show: traceVisibilities.value[i] ?? true,
      alpha: seriesAlpha(i),
      stroke: (_plot: uPlot, seriesIndex: number) => seriesColor(seriesIndex),
      width: seriesLineWidth(i + 1), // Note: our line width and dash pattern get updated in linearPaths().
      // Note: uPlot shifts the path of a trace by up to half a canvas pixel if its line width is not an even number of
      //       canvas pixels (e.g., by half a canvas pixel with a device pixel ratio of 1.5), since its own path
      //       builders round the position of points to whole canvas pixels. Our path builders don't (and neither do our
      //       hover, live points, markers, and exports), so we don't want our traces to be shifted.
      pxAlign: 0,
      paths: linearPaths,
      points: {
        show: seriesHasMarkers,
        paths: markerPaths,
        size: MARKER_SIZE,
        width: 0 // Note: this means that our markers are filled using the trace's colour.
      },
      facets: [
        { scale: 'x', auto: true },
        { scale: 'y', auto: true }
      ],
      auto: false // Note: we determine the range of our data ourselves (see naturalRange()).
    } as uPlot.Series);
  }

  // Create our plot.

  // Note #1: uPlot uses the stroke of an axis for its tick labels and title, which we draw ourselves (see
  //          drawTickLabels() and our template), so it never gets to draw anything with it.
  // Note #2: our grid colour is resolved whenever our plot gets drawn, like our other colours (see
  //          resolveCanvasColors()), so that it follows the CSS variables of our theme (e.g., if they get changed on
  //          one of our ancestors).

  const axis: uPlot.Axis = {
    stroke: 'transparent',
    font: tickFont(),
    labelFont: `${TITLE_FONT_SIZE}px ${fontFamily}`,
    labelGap: 0,
    space: 1,
    ticks: {
      show: false
    },
    grid: {
      stroke: () => canvasColors.grid,
      width: 1
    }
  };

  plot = new uPlot(
    {
      mode: 2,
      width,
      height,
      padding: [0, rightMargin, 0, 0],
      legend: {
        show: false
      },
      cursor: {
        // Note: we only use uPlot's cursor to keep track of the mouse pointer (see updateHover()), and we handle
        //       pointer presses and double-clicks ourselves (see onDragStart() and onDoubleClick()).

        x: false,
        y: false,
        points: {
          show: false
        },
        drag: {
          x: false,
          y: false,
          setScale: false,
          // Note: uPlot stops the propagation of a click on our plotting area if it thinks that it ends a drag, which
          //       it determines using the position of the last mouse press that it handled. However, we handle mouse
          //       presses ourselves, so uPlot would think that most clicks end a drag and stop their propagation (e.g.,
          //       preventing our context menu from being hidden when clicking on our plotting area), hence we let them
          //       propagate.
          click: () => {}
        },
        bind: {
          mousedown: () => null,
          mouseup: () => null,
          dblclick: () => null
        }
      },
      scales: {
        x: {
          time: false,
          range: scaleRange('x')
        },
        y: {
          range: scaleRange('y')
        }
      },
      // Note: our axis titles may contain some basic HTML (e.g., "<i>I<sub>K,r</sub></i>") while uPlot can only render
      //       plain text, so we render them ourselves (see our template), where uPlot would have rendered them. We
      //       still give uPlot an empty label for an axis that has a title, so that it reserves some space for it.
      axes: [
        {
          ...axis,
          scale: 'x',
          side: 2,
          size: props.data.xAxisTitle ? X_AXIS_SIZE_WITH_TITLE : X_AXIS_SIZE_WITHOUT_TITLE,
          label: props.data.xAxisTitle ? '' : undefined,
          labelSize: X_AXIS_TITLE_SIZE,
          splits: axisSplits('x'),
          values: axisValues('x')
        },
        {
          ...axis,
          scale: 'y',
          side: 3,
          size: yAxisSize,
          label: props.data.yAxisTitle ? '' : undefined,
          labelSize: Y_AXIS_TITLE_SIZE,
          labelGap: Y_AXIS_TITLE_GAP,
          splits: axisSplits('y'),
          values: axisValues('y')
        }
      ],
      series,
      hooks: {
        drawClear: [resolveCanvasColors],
        draw: [
          (u: uPlot) => {
            fillTransparentPixels(u);
            updatePlotRect(u);
            updateLivePoints(u);
            updateMarginsAsync();

            // Update our hover tooltip if we have one or if the mouse pointer is over our plotting area, since our plot
            // may have changed (e.g., our data got updated or we zoomed in/out), i.e. our tooltip may have to change,
            // disappear, or appear (e.g., when a live trace reaches the mouse pointer).

            if (hover.value || (u.cursor.left ?? -1) >= 0) {
              queueHoverUpdate();
            }
          }
        ],
        setCursor: [queueHoverUpdate],
        drawAxes: [drawZeroLines, drawTickLabels],
        setSize: [
          (u: uPlot) => {
            // Make sure that our plotting area is at least one pixel wide and high (e.g., if our container is narrower
            // than our Y axis).
            // Note: uPlot doesn't prevent its plotting area from having a negative size, in which case it would render
            //       our plot mirrored. This hook gets called after our plotting area has been laid out and before our
            //       plot gets drawn, so we can check the size of our plotting area here.

            const pxRatio = uPlot.pxRatio;
            const plotWidth = u.bbox.width / pxRatio;
            const plotHeight = u.bbox.height / pxRatio;

            if (plotWidth >= 1 && plotHeight >= 1) {
              return;
            }

            // Enlarge our plot so that its plotting area is at least one pixel wide and high with whatever doesn't fit
            // in our container getting clipped.
            // Note #1: we can't enlarge our plot straight away since uPlot is in the middle of updating it, in which
            //          case it would only partly take our new size into account. So, we enlarge our plot once uPlot is
            //          done with its update, i.e. in a microtask, which also means that the mirrored plot that uPlot is
            //          about to draw gets redrawn before the browser gets to paint it.
            // Note #2: we check that our plot is still the same one as when this hook was called since it could have
            //          been destroyed (and possibly replaced) in the meantime.
            // Note #3: we only ever enlarge our plot here, so that we can't end up in an endless loop.

            const width = Math.ceil(u.width + Math.max(0, 1 - plotWidth));
            const height = Math.ceil(u.height + Math.max(0, 1 - plotHeight));

            queueMicrotask(() => {
              if (plot === u) {
                setPlotSize(u, width, height);
              }
            });
          }
        ]
      }
    } as uPlot.Options,
    plotData(),
    plotDivRef.value as HTMLElement
  ) as uPlot;

  // Handle pointer interaction with our plotting area.
  // Note: uPlot's plotting area (i.e. its "over" element) gets destroyed with our plot, and its event listeners with
  //       it.

  plot.over.addEventListener('pointerdown', (event: PointerEvent) =>
    onDragStart(event, event.shiftKey ? 'pan' : 'nsew')
  );
  plot.over.addEventListener('mousedown', onPressMouseDown);
  plot.over.addEventListener('dblclick', () => onDoubleClick('nsew'));
  plot.over.addEventListener('wheel', (event: WheelEvent) => onWheel(event, 'nsew'), {
    passive: false
  });
};

const updatePlot = (): void => {
  // Make sure that we haven't been unmounted (e.g., if this was scheduled using vue.nextTick() just before we got
  // unmounted) and that we can be shown (e.g., we can't if we are in a hidden file tab, in which case we will be
  // updated once we can be shown, see resize()).

  const mainDiv = mainDivRef.value;

  if (isUnmounted || !mainDiv || !plotDivRef.value) {
    return;
  }

  // Make sure that we have a valid size.

  const width = mainDiv.clientWidth;
  const height = mainDiv.clientHeight;

  if (width <= 0 || height <= 0) {
    isPlotOutdated = true;

    return;
  }

  containerWidth.value = width;

  isPlotOutdated = false;

  // Reset our zoom and forget our last autoranges (see naturalRange()) if we are plotting something else.

  const titles = `${props.data.xAxisTitle ?? ''}::${props.data.yAxisTitle ?? ''}`;

  if (titles !== zoomTitles) {
    zoomTitles = titles;
    zoomRanges = {};

    delete lastAutoRanges.x;
    delete lastAutoRanges.y;

    stopRangeAnimation();
  }

  // Create or update our plot.
  // Note: we only (re)create our plot if needed since it is much cheaper to update its data.

  const signature = `${props.data.traces.length}::${titles}::${isDarkMode.value}::${logAxes.value.x}::${logAxes.value.y}`;
  const newLegendWidth = measureLegendWidth();
  const legendWidthChanged = newLegendWidth !== legendWidth;

  legendWidth = newLegendWidth;

  if (!plot || signature !== plotSignature) {
    // We don't yet have a plot or the signature of our plot has changed, so create a new plot.

    plotSignature = signature;

    createPlot(width, height);
  } else {
    // We already have a plot and its signature hasn't changed, so update the visibility of its series (since our traces
    // may be different ones, e.g., when runs get tracked in interactive mode), its data, and its size (or layout, if
    // the width of our legend has changed since it is part of our right margin), if needed.

    const currentPlot = plot;

    currentPlot.batch(() => {
      for (let i = 1; i < currentPlot.series.length; ++i) {
        const plotSeries = currentPlot.series[i];

        if (plotSeries) {
          plotSeries.show = traceVisibilities.value[i - 1] ?? true;
        }
      }

      currentPlot.setData(plotData());

      if (currentPlot.width !== width || currentPlot.height !== height || legendWidthChanged) {
        currentPlot.setSize({ width, height });
      }
    });
  }
};

// Size tracking of an element, which may get (re)created or removed (e.g., our legend, see its v-if), hence we watch it
// and (re)observe it whenever it changes. Return a method to stop tracking the size of the element.

const trackElementSize = (element: vue.WatchSource<HTMLElement | null>, callback: () => void): (() => void) => {
  let stopObservingElement: (() => void) | undefined;
  const stopWatchingElement = vue.watch(
    element,
    (newElement: HTMLElement | null) => {
      stopObservingElement?.();

      stopObservingElement = newElement ? common.observeSize(newElement, callback) : undefined;
    },
    { immediate: true, flush: 'post' }
  );

  return () => {
    stopWatchingElement();
    stopObservingElement?.();
  };
};

// Vue lifecycle hooks.

vue.onMounted(() => {
  // Start tracking the size of our container so that we can update our plot when it changes.
  // Note: we resize our plot straight away rather than on the next animation frame. Indeed, a resize observer gets
  //       notified after layout but before paint, and uPlot (and Vue) update our plot (and legend) in a microtask, i.e.
  //       before paint too. So, our resized plot gets painted in the same frame as our resized container. This wouldn't
  //       be the case if we were to resize our plot on the next animation frame, in which case our plot (and legend)
  //       would be painted at their old size and position for one frame, i.e. they would flicker. Also, there is no
  //       need to coalesce our resizes since a resize observer gets notified at most once per frame.

  stopTrackingContainerSize = trackElementSize(mainDivRef, () => {
    resize();
  });

  // Start tracking the size of our legend so that we can update the layout of our plot when its width changes since it
  // is part of our right margin.
  // Note: its width can change without our data changing, e.g., when our legend becomes scrollable (or stops being
  //       scrollable) as a result of our plot being resized, in which case it may get a (classic) scrollbar.

  stopTrackingLegendSize = trackElementSize(legendRef, () => {
    syncLegendWidth();
  });

  // Start tracking whether the system uses light mode.

  if (prefersColorScheme) {
    systemUsesLightMode.value = prefersColorScheme.matches;

    prefersColorScheme.addEventListener('change', onPrefersColorSchemeChange);
  }
});

vue.onBeforeUnmount(() => {
  // Make sure that we don't do anything else after we are unmounted.

  isUnmounted = true;

  // Stop tracking whether the system uses light mode.

  prefersColorScheme?.removeEventListener('change', onPrefersColorSchemeChange);

  // Stop zooming (including any zoom animation), hovering, and dragging, and close our range editor (discarding its
  // value).

  if (wheelRafId !== undefined) {
    common.cancelFrame(wheelRafId);

    wheelRafId = undefined;
  }

  if (hoverRafId !== undefined) {
    common.cancelFrame(hoverRafId);

    hoverRafId = undefined;
  }

  stopDrag();
  stopRangeAnimation();

  closeRangeEditor(false);

  // Stop building our path levels (and forget about the data that they are for).

  stopBuildingPathLevels();

  // Destroy our plot, if any.

  plot?.destroy();

  plot = undefined;
});

vue.onUnmounted(() => {
  stopTrackingContainerSize?.();
  stopTrackingLegendSize?.();
});

// Update our plot when the data changes.

vue.watch(
  () => props.data,
  () => {
    void vue.nextTick().then(() => {
      updatePlot();
    });
  },
  { immediate: true }
);

// Update the layout of our plot when our shared margins change.

vue.watch(
  () => props.margins,
  (newMargins: PlotMargins | undefined, oldMargins: PlotMargins | undefined) => {
    // Nothing to do if our margins haven't actually changed (e.g., if we were given a new object with the same values).

    if (sameMargins(newMargins, oldMargins)) {
      return;
    }

    void vue.nextTick().then(() => {
      relayoutPlot();

      // If we are not given shared margins anymore, then emit our margins again (since they may be needed to compute
      // new shared margins).

      if (!props.margins) {
        resetMargins();
      }
    });
  }
);

// Redraw our plot when we are to use our level of detail or not.

vue.watch(
  () => props.levelOfDetail,
  () => {
    plot?.redraw(true);
  }
);

// Show (or hide) the last point of our traces when our data becomes (or stops being) live (see updateLivePoints()).

vue.watch(
  () => props.live,
  () => {
    updateLivePoints(plot);
  }
);

// Update the layout of our plot when our legend gets shown or hidden, whether because of our showLegend property or of
// the width of our container (see legendShown).
// Note: our legend's size observer doesn't get told when our legend gets removed, so we need to do it ourselves.

vue.watch(
  () => legendShown.value,
  () => {
    void vue.nextTick().then(() => {
      syncLegendWidth();
    });
  }
);

// Update our plot when the theme changes.

vue.watch(
  () => isDarkMode.value,
  () => {
    void vue.nextTick().then(() => {
      updatePlot();
    });
  }
);
</script>

<style scoped>
  /**
   * Note: our elements (and those of uPlot, see uPlot.min.css) are sized using their border box, whatever the
   *       consumer's styles are, including our hover tooltip (which may be appended elsewhere, see appendTo).
   */

  .plot-widget,
  .plot-widget *,
  .plot-widget ::before,
  .plot-widget ::after,
  .hover-tooltip,
  .hover-tooltip * {
    box-sizing: border-box;
  }

  .plot-widget {
    display: flex;
    flex-direction: row;
    height: 100%;
  }

  .plot-panel {
    position: relative;
    flex-grow: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  .plot-area {
    position: absolute;
    inset: 0;
  }

  .zoom-box,
  .hover-overlay {
    position: absolute;
    pointer-events: none;
  }

  .zoom-box {
    z-index: 2;
  }

  .hover-overlay {
    z-index: 3;
  }

  .dragger {
    position: absolute;
    z-index: 1;
  }

  .drag-cursor-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
  }

  /**
   * Note: our plot's description is only for assistive technologies (see our template), so we hide it visually.
   */

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    border-width: 0;
    white-space: nowrap;
  }

  .axis-title {
    position: absolute;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
  }

  .axis-title :deep(sub),
  .axis-title :deep(sup),
  .hover-tooltip :deep(sub),
  .hover-tooltip :deep(sup),
  .legend :deep(sub),
  .legend :deep(sup) {
    position: static;
    font-size: 70%;
  }

  .axis-title :deep(sub),
  .hover-tooltip :deep(sub),
  .legend :deep(sub) {
    vertical-align: sub;
  }

  .axis-title :deep(sup),
  .hover-tooltip :deep(sup),
  .legend :deep(sup) {
    vertical-align: super;
  }

  /**
   * Note: our hover tooltip is shown above our panels (so that it doesn't get clipped by short panels), but below our
   *       context menu (see ContextMenuWidget.vue), which z-index is 1000.
   */

  .hover-tooltip {
    position: fixed;
    z-index: 999;
    max-width: 320px;
    padding: 6px 10px;
    border: 1px solid var(--theme-overlay-border-color);
    border-radius: 0.5rem;
    background-color: var(--theme-overlay-background);
    box-shadow: var(--theme-overlay-shadow);
    color: var(--theme-overlay-text-color);
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
  }

  .hover-tooltip-header {
    display: flex;
    gap: 12px;
    margin-bottom: 2px;
    color: var(--theme-muted-text-color);
  }

  .hover-tooltip-header .hover-tooltip-value {
    color: var(--theme-overlay-text-color);
  }

  .hover-tooltip-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hover-tooltip-other-rows {
    color: var(--theme-muted-text-color);
  }

  .hover-tooltip-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .hover-tooltip-swatch {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .hover-tooltip-value {
    margin-left: auto;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .legend {
    position: absolute;
    z-index: 2;
    padding: 5px 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #808ba4 transparent;
    user-select: none;
  }

  /**
   * Note: our legend items are buttons (see our template), which we style like the rest of our legend (and which take
   *       the whole width of our legend, so that their hover background is as wide as our legend). Their focus ring is
   *       drawn inside them since our legend would otherwise clip it (since it can scroll).
   */

  .legend-item {
    position: relative;
    display: block;
    width: calc(100% - 8px);
    min-height: 20px;
    margin: 0 4px;
    padding: 0 6px 0 30px;
    border: none;
    border-radius: var(--theme-border-radius);
    background-color: transparent;
    color: inherit;
    font: inherit;
    line-height: 20px;
    overflow: hidden;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .legend-item:hover {
    background-color: var(--theme-hover-background);
  }

  .legend-item:focus-visible {
    outline: var(--theme-focus-ring-width) solid var(--theme-focus-ring-color);
    outline-offset: calc(-1 * var(--theme-focus-ring-width));
  }

  .legend-item-hidden {
    color: var(--theme-muted-text-color);
  }

  .legend-marker {
    position: absolute;
    top: -2px;
    left: 5.5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: currentcolor;
  }

  .legend-swatch {
    position: absolute;
    top: 8.5px;
    left: 6px;
    width: 18px;
    height: 3px;
    border-radius: 1.5px;
    background-color: currentcolor;
  }

  /**
   * Note: a dashed swatch draws its dash pattern using a gradient (see our template), with square ends, like the dashes
   *       of a trace.
   */

  .legend-swatch-dashed {
    border-radius: 0;
    background-color: transparent;
  }

  /**
   * Note: we use OpenCOR's font (which we inherit, like our axis titles and legend), but with the font size that Plotly
   *       means to use for its range editor, i.e. 12px (Plotly gets its unit wrong, so it actually uses the font size
   *       of the page, i.e. 16px), and with the same line height (relative to its font size) as Plotly's range editor.
   */

  .range-editor {
    position: absolute;
    z-index: 4;
    box-sizing: border-box;
    margin: -0.5px 0 0 -1px;
    padding: 0;
    font-size: 12px;
    line-height: 1.5;
    white-space: nowrap;
    outline: none;
  }

  :deep(.u-over) {
    cursor: crosshair;
  }

  /**
   * Note: a finger (or a pen) used on our plotting area or one of our axes is for us to handle (see Note #4 of the
   *       pointer interaction section), i.e. not for the browser to scroll or zoom the page.
   */

  :deep(.u-over),
  .dragger {
    touch-action: none;
  }

  /**
   * Focus ring of our plot, which is drawn on top of everything (e.g., our legend) and inside our panel (since our
   * panel would otherwise clip it).
   */

  .plot-panel:has(> .plot-area:focus-visible)::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 5;
    outline: var(--theme-focus-ring-width) solid var(--theme-focus-ring-color);
    outline-offset: calc(-1 * var(--theme-focus-ring-width));
    pointer-events: none;
  }

  .plot-area:focus-visible {
    outline: none;
  }
</style>
