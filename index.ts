// Our plotting component, which is our graph panel widget (see GraphPanelWidget.vue), as well as the types that are
// needed to use it (e.g., to provide it with some data or to handle its events).

export type { IconName } from './src/common/icons';
export type {
  IContextMenuAction,
  IContextMenuItem,
  IContextMenuSeparator
} from './src/widgets/ContextMenuWidget.vue';
export type {
  GraphPanelActiveRenderer,
  GraphPanelRenderer,
  GraphPanelTheme,
  IGraphPanelContextMenuEvent,
  IGraphPanelCsvExportEvent,
  IGraphPanelCsvExportFinishedEvent,
  IGraphPanelCsvExportProgressEvent,
  IGraphPanelCsvExportStartedEvent,
  IGraphPanelData,
  IGraphPanelMargins,
  IGraphPanelPlotTrace
} from './src/widgets/GraphPanelWidget.vue';
export { default, default as OpenCORPlot } from './src/widgets/GraphPanelWidget.vue';
