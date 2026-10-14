// @vitest-environment jsdom
// 更新提示的位置约束：无论侧栏折没折叠，它都排在标题栏左侧这一组的最右端。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UpdateSnapshot } from '../../shared/update';
import { useUpdateState } from '../features/settings/update';
import { AppShell } from './AppShell';

// explorer-state 在模块顶层就读 window.matchMedia，jsdom 不提供它；
// 必须在 import 之前装好，所以放在 hoisted 里。
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const available: UpdateSnapshot = {
  phase: 'available',
  currentVersion: '1.0.0',
  version: '1.0.1',
  progress: 0,
  transferred: 0,
  total: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
};

let container: HTMLDivElement;
let root: Root;

const noop = () => {};

function renderShell() {
  return root.render(
    <AppShell
      activeTabIsChat={false}
      canBack={false}
      canForward={false}
      notificationCount={0}
      onBack={noop}
      onDeleteSession={noop}
      onForward={noop}
      onImportFiles={noop}
      onNavigate={noop}
      onNavigateBusiness={noop}
      onNewProject={noop}
      onOpenGeneralChat={noop}
      onOpenProject={noop}
      onOpenSession={noop}
      onOpenSources={noop}
      onSearch={noop}
      onZoomChange={noop}
      projectId={null}
      runBadge={() => null}
      sessionsByProject={{}}
      todoUnreadCount={0}
      view="home"
      zoom={1}
    >
      {null}
    </AppShell>,
  );
}

const byLabel = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label,
  );

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useUpdateState.setState({ snapshot: available });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useUpdateState.setState({ snapshot: null });
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** 侧栏展开时左侧这一组只有导航按钮，提示要跟在前按钮之后。 */
it('侧栏展开时排在前进之后，且是左侧这一组的最后一个', async () => {
  localStorage.setItem('dela.shell.sidebar-collapsed', 'false');
  await act(async () => renderShell());
  const badge = byLabel('有可用的更新')!;
  const forward = byLabel('前进')!;
  expect(badge).toBeTruthy();
  expect(badge.parentElement).toBe(forward.parentElement);
  expect(forward.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...badge.parentElement!.querySelectorAll('button')].at(-1)).toBe(badge);
});

/** 侧栏折叠时左侧这一组多出首页/资料/设置等入口，提示仍要在它们之后。 */
it('侧栏折叠时排在折叠入口之后，依然是最后一个', async () => {
  localStorage.setItem('dela.shell.sidebar-collapsed', 'true');
  await act(async () => renderShell());
  const badge = byLabel('有可用的更新')!;
  const settings = byLabel('设置')!;
  expect(badge).toBeTruthy();
  // 折叠入口自成一组，提示是这一组之后的兄弟节点。
  const collapsedGroup = settings.parentElement!;
  expect(collapsedGroup.parentElement).toBe(badge.parentElement);
  expect(
    collapsedGroup.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect([...badge.parentElement!.querySelectorAll('button')].at(-1)).toBe(badge);
});

it('没有更新可处理时标题栏不留痕迹', async () => {
  localStorage.setItem('dela.shell.sidebar-collapsed', 'false');
  useUpdateState.setState({ snapshot: { ...available, phase: 'up-to-date' } });
  await act(async () => renderShell());
  expect(byLabel('有可用的更新')).toBeUndefined();
});
