import type { NoteMode } from './document-toolbar';

// 默认笔记编辑方式（设置 › 工作区 › defaultNoteEditMode）：app 挂载时经
// settings:get-workspace-prefs 水合；水合前打开的标签回落 rich。
let defaultNoteEditMode: NoteMode = 'rich';

export function getDefaultNoteEditMode(): NoteMode {
  return defaultNoteEditMode;
}

export function setDefaultNoteEditMode(mode: NoteMode): void {
  defaultNoteEditMode = mode;
}
