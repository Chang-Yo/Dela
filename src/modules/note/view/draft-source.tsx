import { createContext, useContext, type ReactNode } from 'react';
import type { DocumentContent } from '../../workspace/contract';

/** 笔记草稿快照：text 为编辑中正文，saved 为最近一次落盘版本，两者不一致即未保存。 */
export type NoteDraft = {
  content: DocumentContent;
  text: string;
  saved: string;
  saving: boolean;
  error: string | null;
};

export interface NoteDraftSource {
  resolveImage(entryId: string, src: string): string;
  acquire(entryId: string, force?: boolean): Promise<void>;
  edit(entryId: string, text: string): void;
  save(entryId: string): Promise<boolean>;
  release(entryId: string): Promise<boolean>;
  saveAsNewNote?(entryId: string, text: string): void;
}

const NoteDraftSourceContext = createContext<NoteDraftSource | null>(null);

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
