// 统一标签拖拽协议（docs/refactor/structure.md §3.2）：application/x-dela-tab，
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
