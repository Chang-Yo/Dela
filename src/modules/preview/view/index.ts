// 文件预览：PreviewTab 按格式分流到各预览器，文档加载与链接分流经 ContentLoader 由外壳注入。
export { PreviewTab, previewBranchOf, type PreviewBranch } from './PreviewTab';
export { parsePreviewTabId, type PreviewTabTarget } from './tab-id';
export {
  ContentLoaderProvider,
  useContentLoader,
  type ContentLoader,
  type LoadedDocument,
} from './loader';
export { useEditorSettings } from './editor-settings';
export { mermaidConfig, renderMermaid } from './mermaid';
export { codeHighlightStyle, markdownHighlightStyle } from './syntax-highlight';
