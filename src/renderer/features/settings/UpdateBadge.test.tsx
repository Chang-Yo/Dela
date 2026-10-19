// @vitest-environment jsdom
// 标题栏更新提示：只在有更新待处理时出现，点击直接落到设置「通用」。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UpdateSnapshot } from '../../../shared/update';
import { useNavigationStore } from '../../navigation/view';
import { UpdateBadge } from './UpdateBadge';
import { useUpdateState } from './update';

const base: UpdateSnapshot = {
  phase: 'idle',
  currentVersion: '1.0.0',
  version: null,
  progress: 0,
  transferred: 0,
  total: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
};

const available: UpdateSnapshot = { ...base, phase: 'available', version: '1.0.1' };

let container: HTMLDivElement;
let root: Root;

const badge = () => container.querySelector('button');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useUpdateState.setState({ snapshot: null });
  useNavigationStore.setState({
    view: 'home',
    settingsRequest: null,
    backStack: [],
    forwardStack: [],
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('没有更新待处理时不占位', async () => {
  await act(async () => root.render(<UpdateBadge />));
  expect(badge()).toBeNull();
});

it('有更新时给出绿色提示，点击跳到设置「通用」', async () => {
  await act(async () => {
    useUpdateState.setState({ snapshot: available });
    root.render(<UpdateBadge />);
  });
  expect(badge()?.getAttribute('aria-label')).toBe('有可用的更新');
  expect(badge()?.className).toContain('text-green');
  await act(async () => badge()!.click());
  expect(useNavigationStore.getState().view).toBe('settings');
  expect(useNavigationStore.getState().settingsRequest).toEqual({ section: 'general' });
});

it('下载中仍然提示：用户这时候多半已经离开设置页了', async () => {
  await act(async () => {
    useUpdateState.setState({ snapshot: { ...base, phase: 'downloading', progress: 0.4 } });
    root.render(<UpdateBadge />);
  });
  expect(badge()).not.toBeNull();
});
