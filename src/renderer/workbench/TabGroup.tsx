// 标签组：标签栏 + 内容宿主（经 registry 解析组件）+ 边缘拖放分屏。
// 同组只挂载活动标签（沿用旧 EditorLayout 行为）；组内非活动标签状态由内容组件本地保留与否自决。
import { memo, Suspense, useEffect, useRef, useState, type DragEvent } from 'react';
import type { GroupNode, TabId } from '../../shared/layout';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { cn } from '../lib/utils';
import { EmptyState } from './EmptyState';
import { ExplorerRevealButton } from './explorer-state';
import { walkGroups } from './layout-schema';
import { useWorkbenchLayout } from './layout-store';
import { kindOf, registry, titleOf } from './registry';
import { TabBar } from './TabBar';
import {
  getCurrentTabDrag,
  hasTabDrag,
  parseTabDrag,
  setCurrentTabDrag,
  tabDragType,
  tabDropZone,
  type EdgeZone,
} from './tab-dnd';

/** 懒加载内容域的首帧占位：静态色块骨架（inset 底），不做动画。 */
function TabSuspenseFallback() {
  return <div className="min-h-0 min-w-0 flex-1 bg-inset" />;
}

/** 活动标签内容宿主：props 全为原始值，组的 chrome 重渲（聚焦切换、悬停反馈）不牵连内容组件。 */
const GroupTabContent = memo(function GroupTabContent({
  groupId,
  tabId,
}: {
  groupId: string;
  tabId: TabId;
}) {
  const Component = registry[kindOf(tabId)].component;
  return (
    <Suspense fallback={<TabSuspenseFallback />}>
      <Component key={`${groupId}:${tabId}`} groupId={groupId} tabId={tabId} />
    </Suspense>
  );
});

const dropPreviewClass: Record<EdgeZone | 'center', string> = {
  left: 'top-0 left-0 h-full w-1/2',
  right: 'top-0 left-1/2 h-full w-1/2',
  top: 'top-0 left-0 h-1/2 w-full',
  bottom: 'top-1/2 left-0 h-1/2 w-full',
  center: 'top-0 left-0 h-full w-full',
};

export const TabGroup = memo(function TabGroup({
  group,
  onNewChat,
}: {
  group: GroupNode;
  onNewChat: () => void;
}) {
  // 订阅派生布尔而非 focus/maximized 原值：只有本组的未聚焦态翻转时才重渲（评审 1）。
  const unfocused = useWorkbenchLayout((s) => s.maximized === null && s.focus !== group.id);
  const revealAnchor = useWorkbenchLayout(
    (s) => (s.maximized ?? walkGroups(s.root)[0]?.id ?? null) === group.id,
  );
  const focusGroup = useWorkbenchLayout((s) => s.focusGroup);
  const moveTab = useWorkbenchLayout((s) => s.moveTab);
  const moveTabToEdge = useWorkbenchLayout((s) => s.moveTabToEdge);
  const [dropPreview, setDropPreview] = useState<{ zone: EdgeZone | 'center'; visible: boolean }>({
    zone: 'center',
    visible: false,
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const clearDropPreview = () =>
    setDropPreview((previous) => (previous.visible ? { ...previous, visible: false } : previous));

  useEffect(() => {
    if (!dropPreview.visible) return;
    const clear = () => setDropPreview((previous) => ({ ...previous, visible: false }));
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [dropPreview.visible]);

  const zoneAt = (event: DragEvent<HTMLElement>) => {
    const rect = contentRef.current!.getBoundingClientRect();
    return tabDropZone(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    if (!contentRef.current?.contains(event.target as Node)) {
      clearDropPreview();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const zone = zoneAt(event);
    const sameGroup = getCurrentTabDrag()?.fromGroup === group.id;
    // 原组中央没有移动效果；单标签也不能向自身分出空组。
    if (sameGroup && (!zone || group.tabs.length === 1)) {
      clearDropPreview();
      return;
    }
    const previewZone = zone ?? 'center';
    setDropPreview((previous) =>
      previous.visible && previous.zone === previewZone
        ? previous
        : { zone: previewZone, visible: true },
    );
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    // 标签栏 → 正文属于组内移动，只有离开整组才清除反馈。
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      clearDropPreview();
    }
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    if (!contentRef.current?.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    const zone = zoneAt(event);
    clearDropPreview();
    const payload = parseTabDrag(event.dataTransfer.getData(tabDragType));
    setCurrentTabDrag(null);
    if (!payload) return;
    if (!zone && payload.fromGroup === group.id) return;
    if (zone) moveTabToEdge(payload.tabId, payload.fromGroup, group.id, zone);
    else moveTab(payload.tabId, payload.fromGroup, group.id);
  };

  const active = group.active;

  return (
    <section
      aria-label={active ? `工作组：${titleOf(active)}` : '工作组'}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden @container"
      onPointerDown={() => focusGroup(group.id)}
      onDragOverCapture={onDragOver}
      onDragLeave={onDragLeave}
      onDropCapture={onDrop}
    >
      <TabBar group={group} unfocused={unfocused} showReveal={revealAnchor} />
      {/* 空组没有标签栏可挂展开入口：锚定在标签栏左端同一坐标（px-2 pt-1 + self-end mb-1
          即左上 8px/8px），最后一个标签关闭时按钮不位移，也不落进空态的居中栈。
          z-10 压过后方内容层（relative 且 DOM 靠后，会整层拦截指针）。 */}
      {revealAnchor && !group.tabs.length && (
        <ExplorerRevealButton className="absolute left-2 top-2 z-10" />
      )}
      <div ref={contentRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {active ? (
          <div
            aria-labelledby={`tab-${group.id}-${active}`}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            id={`tabpanel-${group.id}`}
            role="tabpanel"
          >
            {/* 单标签崩溃只降级该标签；key 随活动标签切换，旧错误态不污染新标签。 */}
            <ErrorBoundary key={active} title="此标签遇到错误">
              <GroupTabContent groupId={group.id} tabId={active} />
            </ErrorBoundary>
          </div>
        ) : (
          <EmptyState onNewChat={onNewChat} />
        )}
        {/* 预览覆盖正文、不染组背景；半屏与实际二等分结果一致。
            复用现有明暗主题蓝色 token，15% 不透明度保持正文可读。 */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute z-10 rounded-card bg-bui-accent-tint ring-1 ring-inset ring-bui-accent/30 transition-[top,left,width,height,opacity] duration-150 ease-out motion-reduce:transition-none',
            dropPreviewClass[dropPreview.zone],
            dropPreview.visible ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </section>
  );
});
