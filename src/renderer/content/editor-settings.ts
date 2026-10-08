import { create } from 'zustand';

// 源码编辑和文本预览共用显示偏好；仅调整软换行，不写入文件换行符。
export const useEditorSettings = create<{
  wordWrap: boolean;
  toggleWordWrap: () => void;
}>((set) => ({
  wordWrap: false,
  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
}));
