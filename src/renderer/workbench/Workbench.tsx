// 工作台根：渲染项目布局（或最大化组/窄屏单列），承接布局类快捷键。
// 布局载入由 WorkbenchShell 负责；home 不挂载本组件，预热后进入可避免首帧空白。
import { type KeyboardEvent } from 'react';
import type { KeybindingMap } from '../../shared/keybindings';
import { digitFromEvent, matchShortcut } from '../../shared/keybindings';
import { useWorkbenchLayout } from './layout-store';
import { findGroup, walkGroups } from './layout-schema';
import { SplitNodeView } from './SplitNode';
import { TabGroup } from './TabGroup';
import { platform } from '../lib/platform';

/** 键位表与「新建对话」由装配层传入（workbench 不反向依赖 app 的 store）。 */
export function Workbench({
  bindings,
  onNewChat,
}: {
  bindings: KeybindingMap;
  onNewChat: () => void;
}) {
  const ready = useWorkbenchLayout((s) => s.ready);
  const root = useWorkbenchLayout((s) => s.root);
  const maximized = useWorkbenchLayout((s) => s.maximized);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const action = matchShortcut(bindings, event.nativeEvent, 'workbench', platform);
    if (!action) return;
    if (target?.closest('[role="dialog"]')) return;
    // Mac 的关标签组合即使焦点在编辑器/终端中也生效；Control 继续交给编辑器与 shell。
    const macCloseTab = platform === 'mac' && action === 'close-tab' && event.metaKey;
    if (!macCloseTab && target?.closest('input, textarea, .cm-editor, [contenteditable="true"]'))
      return;
    const store = useWorkbenchLayout.getState();
    // Alt+数字聚焦第 N 组。
    if (action === 'focus-group') {
      const digit = digitFromEvent(event.nativeEvent);
      const group = digit === null ? undefined : walkGroups(store.root)[digit - 1];
      if (!group) return;
      event.preventDefault();
      store.focusGroup(group.id);
      return;
    }
    if (action === 'split-right') {
      event.preventDefault();
      store.splitGroup(store.focus, 'vertical');
      return;
    }
    const group = findGroup(store.root, store.focus);
    if (action === 'close-tab') {
      if (group?.active) {
        event.preventDefault();
        store.closeTab(group.active, group.id);
      }
      return;
    }
    if (action === 'next-tab' || action === 'previous-tab') {
      if (!group || group.tabs.length < 2) return;
      event.preventDefault();
      const current = Math.max(0, group.tabs.indexOf(group.active ?? group.tabs[0]!));
      const offset = action === 'next-tab' ? 1 : -1;
      store.openTab(
        group.tabs[(current + offset + group.tabs.length) % group.tabs.length]!,
        group.id,
      );
    }
  };

  if (!ready)
    // 布局加载中：保持工作台底色稳定，不闪默认空组。
    return <div className="flex min-h-0 flex-1 overflow-hidden bg-surface" />;

  const maximizedGroup = maximized ? findGroup(root, maximized) : null;
  const content = maximizedGroup ? (
    <TabGroup group={maximizedGroup} onNewChat={onNewChat} />
  ) : (
    <SplitNodeView node={root} path={[]} onNewChat={onNewChat} />
  );

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="relative flex min-h-0 flex-1 overflow-hidden bg-surface outline-none"
    >
      {content}
    </div>
  );
}
