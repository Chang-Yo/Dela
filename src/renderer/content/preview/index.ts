// 文件预览内容域（docs/refactor/structure.md §3.3）：PreviewTab 按格式分流到各预览器，
// 文档加载与链接/导航分流经 ContentLoader 注入（3B 由 workspace/canvas 镜像接线）。
export {
  PreviewTab,
  parsePreviewTabId,
  previewBranchOf,
  type PreviewTabTarget,
  type PreviewBranch,
} from './PreviewTab';
export {
  ContentLoaderProvider,
  useContentLoader,
  type ContentLoader,
  type LoadedDocument,
} from './loader';
