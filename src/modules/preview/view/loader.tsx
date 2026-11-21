import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { Navigate, SourceDocumentProps } from '../../../app/module';
import type { DocumentContent, ResourceAddress, TabId } from '../../../core/protocol/workbench';

export interface LoadedDocument {
  content: DocumentContent;
  source?: { id: string; document: ComponentType<SourceDocumentProps> };
  officeAddress?: ResourceAddress;
  watchesDisk?: boolean;
}

/** 注入接口：preview 不感知条目树与读取 IPC，由外壳接线。 */
export interface ContentLoader {
  loadDocument(tabKey: TabId): Promise<LoadedDocument>;
  /** 文档内链接分流：站内文件开预览标签，其余交主进程（模块认领的回应用内，否则走系统浏览器）。 */
  openLink(url: string): void;
  navigate: Navigate;
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
