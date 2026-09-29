// 工作台根：载入项目布局、渲染根节点（或最大化组/窄屏单列），承接布局类快捷键。
// 挂载入口在批次 3B 由 App 切换；本组件不 import 任何 features/。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../lib/utils';
import { useWorkbenchLayout } from './layout-store';
import type { LegacySeedInput } from './layout-schema';
import { findGroup, walkGroups } from './layout-schema';
import { SplitNodeView } from './SplitNode';
import { TabGroup } from './TabGroup';

/** 窄屏断点：多组不再压缩，改为单列滚动（计划 §4.2：优先收纳次要控件）。 */
const NARROW_QUERY = '(max-width: 899px)';

export function Workbench({
  projectId = null,
  legacy,
}: {
  projectId?: string | null;
  legacy?: LegacySeedInput;
}) {
  const ready = useWorkbenchLayout((s) => s.ready);
  const root = useWorkbenchLayout((s) => s.root);
  const maximized = useWorkbenchLayout((s) => s.maximized);
  // legacy 每次渲染都可能是新对象引用（父组件内联构造）；init 只随项目切换触发。
  const legacyRef = useRef(legacy);
  legacyRef.current = legacy;
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );

  useEffect(() => {
    void useWorkbenchLayout.getState().init(projectId, legacyRef.current);
  }, [projectId]);

  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('[role="dialog"], input, textarea, .cm-editor, [contenteditable="true"]'))
      return;
    const store = useWorkbenchLayout.getState();
    const modifier = event.metaKey || event.ctrlKey;
    // Alt+数字聚焦第 N 组（沿用旧 Alt+1/2，泛化到 N 组）。
    if (event.altKey && !modifier && /^[1-9]$/.test(event.key)) {
      const group = walkGroups(store.root)[Number(event.key) - 1];
      if (group) {
        event.preventDefault();
        store.focusGroup(group.id);
      }
      return;
    }
    if (!modifier) return;
    if (event.key === '\\') {
      event.preventDefault();
      store.splitGroup(store.focus, 'vertical');
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      const group = findGroup(store.root, store.focus);
      if (!group || group.tabs.length < 2) return;
      event.preventDefault();
      const current = Math.max(0, group.tabs.indexOf(group.active ?? group.tabs[0]!));
      const offset = event.key === 'PageDown' ? 1 : -1;
      store.openTab(
        group.tabs[(current + offset + group.tabs.length) % group.tabs.length]!,
        group.id,
      );
    } else if (event.key.toLowerCase() === 'w') {
      const group = findGroup(store.root, store.focus);
      if (group?.active) {
        event.preventDefault();
        store.closeTab(group.active, group.id);
      }
    }
  };

  if (!ready)
    // 布局加载中：保持工作台底色稳定，不闪默认空组。
    return <div className="flex min-h-0 flex-1 overflow-hidden bg-background" />;

  const maximizedGroup = maximized ? findGroup(root, maximized) : null;
  const content = maximizedGroup ? (
    <TabGroup group={maximizedGroup} />
  ) : narrow ? (
    walkGroups(root).map((group) => (
      <div key={group.id} className="flex h-full shrink-0 flex-col">
        <TabGroup group={group} />
      </div>
    ))
  ) : (
    <SplitNodeView node={root} path={[]} />
  );

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex min-h-0 flex-1 overflow-hidden bg-background outline-none',
        narrow && !maximizedGroup ? 'flex-col overflow-y-auto' : undefined,
      )}
    >
      {content}
    </div>
  );
}
