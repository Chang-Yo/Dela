// 文本文件编辑域：NoteTab 为标签内容组件，草稿经
// NoteDraftSource 注入（由 note/drafts 接线），编辑器状态按 TabId+groupId 键控。
export { NoteTab, parseNoteTabId } from './NoteTab';
export {
  NoteDraftSourceProvider,
  useNoteDraftSource,
  type NoteDraft,
  type NoteDraftSource,
} from './draft-source';
