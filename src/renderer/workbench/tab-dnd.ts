// 统一标签拖拽协议：application/x-dela-tab，
// 是旧 application/x-dela-editor-tab 的泛化（负载带 kind 的 TabId + 来源组）。
import type { TabId } from '../../shared/layout';

export const tabDragType = 'application/x-dela-tab';

export interface TabDragPayload {
  tabId: TabId;
  fromGroup: string;
}

const tabIdPattern = /^(?:chat|note|preview|review):.+$/;

export function encodeTabDrag(payload: TabDragPayload): string {
  return JSON.stringify(payload);
}

/** 解析拖拽负载；数据缺失或来自无关拖拽源时返回 null（调用方静默忽略）。 */
export function parseTabDrag(raw: string | null | undefined): TabDragPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TabDragPayload>;
    if (
      typeof value.tabId !== 'string' ||
      !tabIdPattern.test(value.tabId) ||
      typeof value.fromGroup !== 'string' ||
      !value.fromGroup
    )
      return null;
    return { tabId: value.tabId as TabId, fromGroup: value.fromGroup };
  } catch {
    return null;
  }
}

export function hasTabDrag(dataTransfer: { types: readonly string[] }): boolean {
  return dataTransfer.types.includes(tabDragType);
}

/** 边缘拖放分屏的目标区：left/right → 左右（vertical），top/bottom → 上下（horizontal）。 */
export const edgeZones = ['left', 'right', 'top', 'bottom'] as const;
export type EdgeZone = (typeof edgeZones)[number];

// VS Code editorDropTarget：标签进入外沿 10% 才分屏，左右方向在角落占宽度的三分之一。
// 触发带和预览尺寸分开：预览应显示最终的二等分范围。
const EDGE_DROP_BAND = 0.1;

export function tabDropZone(x: number, y: number): EdgeZone | null {
  if (x > EDGE_DROP_BAND && x < 1 - EDGE_DROP_BAND && y > EDGE_DROP_BAND && y < 1 - EDGE_DROP_BAND)
    return null;
  if (x < 1 / 3) return 'left';
  if (x > 2 / 3) return 'right';
  return y < 0.5 ? 'top' : 'bottom';
}

// dragover 阶段浏览器隐藏 DataTransfer 正文，内部拖拽身份从 dragstart 保存到 dragend。
let currentTabDrag: TabDragPayload | null = null;

export function setCurrentTabDrag(payload: TabDragPayload | null): void {
  currentTabDrag = payload;
}

export function getCurrentTabDrag(): TabDragPayload | null {
  return currentTabDrag;
}
