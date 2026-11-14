// 文本文件编辑：NoteTab 为标签内容组件，草稿经 NoteDraftSource 注入（外壳用 useNoteDrafts 接线）。
export { NoteTab, parseNoteTabId } from './NoteTab';
export {
  NoteDraftSourceProvider,
  useNoteDraftSource,
  type NoteDraft,
  type NoteDraftSource,
} from './draft-source';
export { useNoteDrafts } from './drafts';
export { MarkdownEditor } from './MarkdownEditor';
