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
 * NoteTab 的草稿数据源（注入接口；docs/agent-workspace-plan.md §6.2 的呈现层准备）。
 * 3B 由 renderer/workspace/drafts.ts 接线：useDraft 订阅草稿，acquire/release 按引用
 * 计数持有，edit 进入 600ms 防抖保存队列，save 立即冲盘。NoteTab 不感知 store 形态。
 */
export interface NoteDraftSource {
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
  /** 保存失败后的兜底：把当前正文另存为新笔记（原「另存为新笔记」入口）；未接线时不显示。 */
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

export function useNoteDraftSource(): NoteDraftSource | null {
  return useContext(NoteDraftSourceContext);
}
