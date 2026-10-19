import { createContext, useContext, type ReactNode } from 'react';
import type { DocumentContent } from '../../../shared/api';

/** 笔记草稿快照：text 为编辑中正文，saved 为最近一次落盘版本，两者不一致即未保存。 */
export type NoteDraft = {
  content: DocumentContent;
  text: string;
  saved: string;
  saving: boolean;
  error: string | null;
};

/**
 * NoteTab 的草稿数据源（注入接口）：由 content/note/drafts.ts 接线，NoteTab 不感知 store 形态。
 */
export interface NoteDraftSource {
  /** 订阅文档的工作区层级路径；由装配层解析目录，内容层只负责展示。 */
  usePath?(entryId: string): string[];
  /** 订阅草稿状态；尚未建立时为 undefined。 */
  useDraft(entryId: string): NoteDraft | undefined;
  /** 建立或刷新草稿；force 时等在途保存结束后重读磁盘。 */
  acquire(entryId: string, force?: boolean): Promise<void>;
  /** 修改正文（进入防抖自动保存队列）。 */
  edit(entryId: string, text: string): void;
  /** 立即保存；干净（或已干净）时 resolve true。 */
  save(entryId: string): Promise<boolean>;
  /** 关闭入口前冲盘并释放草稿；仍有未保存内容时 resolve false。 */
  release(entryId: string): Promise<boolean>;
  /** 保存失败后的兜底：把当前正文另存为新笔记；未接线时不显示。 */
  saveAsNewNote?(entryId: string, text: string): void;
}

export const NoteDraftSourceContext = createContext<NoteDraftSource | null>(null);

export function NoteDraftSourceProvider({
  source,
  children,
}: {
  source: NoteDraftSource;
  children: ReactNode;
}) {
  return (
    <NoteDraftSourceContext.Provider value={source}>{children}</NoteDraftSourceContext.Provider>
  );
}

export function useNoteDraftSource(): NoteDraftSource {
  const source = useContext(NoteDraftSourceContext);
  if (!source) throw new Error('NoteDraftSourceProvider 未挂载');
  return source;
}
