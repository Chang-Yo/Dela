// 笔记内容域：NoteTab 为标签内容组件，草稿经
// NoteDraftSource 注入（3B 由 note/drafts 接线），编辑器状态按 TabId+groupId 键控。
export { NoteTab, parseNoteTabId } from './NoteTab';
export {
  NoteDraftSourceProvider,
  useNoteDraftSource,
  type NoteDraft,
  type NoteDraftSource,
} from './draft-source';
/** 3B 关闭标签时按需清理编辑器会话（撤销历史/光标缓存）。 */
export { forgetNoteEditorState } from './NoteEditor';
