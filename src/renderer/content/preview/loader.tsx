import { createContext, useContext, type ReactNode } from 'react';
import type { TabId } from '../../../shared/layout';
import type { DocumentContent } from '../../../shared/api';
import type { ResourceRef } from '../../../shared/resources';

/** loadDocument 的结果：文档内容 + 呈现所需的定位上下文（由接线方按条目/资料解析）。 */
export interface LoadedDocument {
  content: DocumentContent;
  /** 水源主题来源：设置时呈现水源来源视图（原 ProjectDocument 的水源分支）。 */
  shuiyuanTopicId?: number;
  /** pptx 导出/快速预览的定位引用；Canvas 资料与本地条目各指向其资源。 */
  officeRef?: ResourceRef;
  /** 本地 Markdown 的相对图片改写为受限资源协议；不传则按原样输出。 */
  resolveImage?: (src: string) => string;
  /** 本地磁盘文件：窗口聚焦时强制重读（外部编辑刷新），文本文件用语法高亮查看器。 */
  watchesDisk?: boolean;
}

/**
 * PreviewTab 的内容接入（注入接口）：preview 域不感知条目树/Canvas 状态与读取 IPC，
 * 3B 由 workspace/canvas 镜像接线。tabKey 形如 preview:{entryId} 或
 * preview:source:{原 documentKey}（@ 引用型资料）。
 */
export interface ContentLoader {
  /** 读取 TabKey 对应的文档（重载/导出后重读同一路径）。 */
  loadDocument(tabKey: TabId): Promise<LoadedDocument>;
  /** 文档内链接分流：站内已同步 Canvas 文件开预览标签，其余交系统浏览器。 */
  openLink(url: string): void;
  /** 在水源页打开主题（跳转水源视图）。 */
  openShuiyuanTopic(topicId: number, postNumber?: number): void;
  /** pptx 导出完成通知（如刷新目录树）；文档重读由 PreviewTab 自理。 */
  onExported?(tabKey: TabId): void;
}

export const ContentLoaderContext = createContext<ContentLoader | null>(null);

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
