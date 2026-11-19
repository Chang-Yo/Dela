// 阅读位置按 标签+组 在本次运行内记忆，切换标签不丢，不持久化。
import { create } from 'zustand';

const usePreviewScroll = create<Record<string, number>>(() => ({}));

export const rememberPreviewScroll = (scrollKey: string, top: number) =>
  usePreviewScroll.setState({ [scrollKey]: top });

export const previewScrollOf = (scrollKey: string) => usePreviewScroll.getState()[scrollKey] ?? 0;
