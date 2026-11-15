// 编辑模式（按文件）与滚动位置（按 标签+组）在本次运行内记忆，切换标签后恢复，不持久化。
import { create } from 'zustand';
import type { NoteMode } from './document-toolbar';

export const useNoteViewMemory = create<{
  modes: Record<string, NoteMode>;
  scrolls: Record<string, number>;
}>(() => ({ modes: {}, scrolls: {} }));

export const rememberNoteMode = (entryId: string, mode: NoteMode) =>
  useNoteViewMemory.setState((state) => ({ modes: { ...state.modes, [entryId]: mode } }));

export const rememberNoteScroll = (scrollKey: string, top: number) =>
  useNoteViewMemory.setState((state) => ({ scrolls: { ...state.scrolls, [scrollKey]: top } }));
