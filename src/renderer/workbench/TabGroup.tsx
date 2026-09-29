// 标签组：标签栏 + 内容宿主（经 registry 解析组件）+ 边缘拖放分屏。
// 同组只挂载活动标签（沿用旧 EditorLayout 行为）；组内非活动标签状态由内容组件本地保留与否自决。
import { useState, type DragEvent } from 'react';
import type { GroupNode } from '../../shared/layout';
import { cn } from '../lib/utils';
import { EmptyState } from './EmptyState';
import { useWorkbenchLayout } from './layout-store';
import { kindOf, registry } from './registry';
import { TabBar } from './TabBar';
import { hasTabDrag, parseTabDrag, tabDragType, type EdgeZone } from './tab-dnd';

/** 距组边缘的比例带宽：光标进入该带内松手 = 在该侧分出新组（VS Code 同款 quarter 约量级）。 */
const EDGE_DROP_BAND = 0.25;

const edgeZoneClass: Record<EdgeZone, string> = {
  left: 'inset-y-0 left-0 w-1/4',
  right: 'inset-y-0 right-0 w-1/4',
  top: 'inset-x-0 top-0 h-1/4',
  bottom: 'inset-x-0 bottom-0 h-1/4',
};

export function TabGroup({ group }: { group: GroupNode }) {
  const focus = useWorkbenchLayout((s) => s.focus);
  const maximized = useWorkbenchLayout((s) => s.maximized);
  const focusGroup = useWorkbenchLayout((s) => s.focusGroup);
  const moveTab = useWorkbenchLayout((s) => s.moveTab);
  const moveTabToEdge = useWorkbenchLayout((s) => s.moveTabToEdge);
  const [edgeZone, setEdgeZone] = useState<EdgeZone | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOver(true);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setEdgeZone(
      x < EDGE_DROP_BAND
        ? 'left'
        : x > 1 - EDGE_DROP_BAND
          ? 'right'
          : y < EDGE_DROP_BAND
            ? 'top'
            : y > 1 - EDGE_DROP_BAND
              ? 'bottom'
              : null,
    );
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    // 标签栏 → 正文属于组内移动，只有离开整组才清除反馈。
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setEdgeZone(null);
      setDragOver(false);
    }
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    const zone = edgeZone;
    setEdgeZone(null);
    setDragOver(false);
    const payload = parseTabDrag(event.dataTransfer.getData(tabDragType));
    if (!payload) return;
    if (zone) moveTabToEdge(payload.tabId, payload.fromGroup, group.id, zone);
    else moveTab(payload.tabId, payload.fromGroup, group.id);
  };

  const unfocused = maximized === null && focus !== group.id;
  const active = group.active;
  const ActiveTab = active ? registry[kindOf(active)].component : null;

  return (
    <section
      aria-label="工作组"
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        // 拖拽悬停整组高亮：提示松手会移入该组（反馈克制，仅色调变化）。
        dragOver && 'ring-1 ring-inset ring-border bg-accent/30',
      )}
      onPointerDown={() => focusGroup(group.id)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TabBar group={group} unfocused={unfocused} />
      {active && ActiveTab ? (
        <ActiveTab key={`${group.id}:${active}`} tabId={active} groupId={group.id} />
      ) : (
        <EmptyState />
      )}
      {/* 边缘分屏落点反馈：静态色块，不改变任何既有元素位置。 */}
      {edgeZone && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute z-10 bg-accent/30 ring-1 ring-inset ring-accent',
            edgeZoneClass[edgeZone],
          )}
        />
      )}
    </section>
  );
}
