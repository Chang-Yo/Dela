import { create } from 'zustand';

// 笔记编辑器的系统拼写检查（设置 › 工作区 › noteSpellcheck）：app 挂载时经
// settings:get-workspace-prefs 水合，默认关闭；开关写入后即时作用于已挂载的编辑器。
export const useNoteSpellcheck = create<{
  spellcheck: boolean;
  setSpellcheck: (value: boolean) => void;
}>((set) => ({
  spellcheck: false,
  setSpellcheck: (value) => set({ spellcheck: value }),
}));
