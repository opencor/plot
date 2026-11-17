// Our plotting component, which is our plot widget (see PlotWidget.vue), as well as the types that are needed to use
// it (e.g., to provide it with some data or to handle its events).

export type { IconName } from './src/common/icons';
export type {
  IContextMenuAction,
  IContextMenuItem,
  IContextMenuSeparator
} from './src/widgets/ContextMenuWidget.vue';
export type {
  PlotActiveRenderer,
  PlotRenderer,
  PlotTheme,
  IPlotContextMenuEvent,
  IPlotCsvExportEvent,
  IPlotCsvExportFinishedEvent,
  IPlotCsvExportProgressEvent,
  IPlotCsvExportStartedEvent,
  IPlotData,
  IPlotMargins,
  IPlotTrace
} from './src/widgets/PlotWidget.vue';
export { default, default as OpenCORPlot } from './src/widgets/PlotWidget.vue';
