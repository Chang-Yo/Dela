// 工作台根：渲染项目布局（或最大化组/窄屏单列），承接布局类快捷键。
// 布局载入（init）由装配层 workbench-shell 负责：home 视图不挂载本组件，若等首条
// 消息切入工作台才 init，切换会闪一次空白重载；装配层预热后此处首帧即有布局。
import { type KeyboardEvent } from 'react';
import { useWorkbenchLayout } from './layout-store';
import { findGroup, walkGroups } from './layout-schema';
import { SplitNodeView } from './SplitNode';
import { TabGroup } from './TabGroup';

export function Workbench() {
  const ready = useWorkbenchLayout((s) => s.ready);
  const root = useWorkbenchLayout((s) => s.root);
  const maximized = useWorkbenchLayout((s) => s.maximized);

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
  ) : (
    <SplitNodeView node={root} path={[]} />
  );

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="relative flex min-h-0 flex-1 overflow-hidden bg-background outline-none"
    >
      {content}
    </div>
  );
}
