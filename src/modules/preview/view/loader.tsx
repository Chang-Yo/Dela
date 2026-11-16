import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { Navigate, SourceDocumentProps } from '../../../app/module';
import type { DocumentContent, ResourceRef, TabId } from '../../workspace/contract';

/** loadDocument 的结果：文档内容 + 呈现所需的定位上下文（由接线方按条目/资料解析）。 */
export interface LoadedDocument {
  content: DocumentContent;
  /** 模块自带正文视图的来源：设置时由该视图呈现。 */
  source?: { id: string; document: ComponentType<SourceDocumentProps> };
  /** pptx 导出/快速预览的定位引用；Canvas 资料与本地条目各指向其资源。 */
  officeRef?: ResourceRef;
  /** 本地磁盘文件：窗口聚焦时强制重读（外部编辑刷新），文本文件用语法高亮查看器。 */
  watchesDisk?: boolean;
}

/**
 * PreviewTab 的内容接入（注入接口）：preview 域不感知条目树/Canvas 状态与读取 IPC，由
 * workspace/canvas 镜像接线。tabKey 形如 preview:{entryId} 或 preview:source:{原 documentKey}
 * （@ 引用型资料）。
 */
export interface ContentLoader {
  /** 读取 TabKey 对应的文档（重载/导出后重读同一路径）。 */
  loadDocument(tabKey: TabId): Promise<LoadedDocument>;
  /** 文档内链接分流：站内已同步 Canvas 文件开预览标签，其余交主进程（模块认领的回应用内，其余走系统浏览器）。 */
  openLink(url: string): void;
  navigate: Navigate;
  /** pptx 导出完成通知（如刷新目录树）；文档重读由 PreviewTab 自理。 */
  onExported?(tabKey: TabId): void;
}

const ContentLoaderContext = createContext<ContentLoader | null>(null);

export function ContentLoaderProvider({
  loader,
  children,
}: {
  loader: ContentLoader;
  children: ReactNode;
}) {
  return <ContentLoaderContext.Provider value={loader}>{children}</ContentLoaderContext.Provider>;
}

export function useContentLoader(): ContentLoader {
  const loader = useContext(ContentLoaderContext);
  if (!loader) throw new Error('ContentLoaderProvider 未挂载');
  return loader;
}
