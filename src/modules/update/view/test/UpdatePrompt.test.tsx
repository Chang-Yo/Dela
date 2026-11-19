// @vitest-environment jsdom
// 下载完成才弹确认；答过不再问，下一版重新问；保存与安装期间保持模态锁。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UpdateSnapshot } from '../../contract';
// 契约客户端在模块加载时取 bridge，须先于导入视图装好；各用例只替换通道实现。
const bridge = vi.hoisted(() => {
  const procedures = new Map<string, () => Promise<unknown>>();
  const dela = {
    bridge: {
      invoke: async (channel: string) => procedures.get(channel)?.(),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  window.dela = dela;
  return { procedures, dela };
});
import { UpdatePrompt } from '../UpdatePrompt';
import { useUpdateState } from '../update';

const readyState: UpdateSnapshot = {
  phase: 'ready',
  currentVersion: '1.0.0',
  version: '1.0.1',
  progress: 1,
  transferred: 0,
  total: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
};

let container: HTMLDivElement;
let root: Root;

/** 弹窗经 Portal 挂在 document.body 上，不在 container 里。 */
function button(text: string): HTMLButtonElement {
  const element = [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

async function show(snapshot: UpdateSnapshot | null) {
  await act(async () => {
    useUpdateState.setState({ snapshot });
    root.render(<UpdatePrompt />);
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const name of ['state', 'check', 'download', 'install', 'deferInstall'])
    bridge.procedures.set(`update:${name}`, async () => readyState);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useUpdateState.setState({ snapshot: null, preparingInstall: false, dismissedVersion: null });
  bridge.procedures.clear();
  window.dela = bridge.dela;
  vi.unstubAllGlobals();
});

it('只有下载完成才弹：其它阶段都不打扰用户', async () => {
  const quiet = ['idle', 'checking', 'up-to-date', 'available', 'downloading'];
  for (const phase of quiet) {
    await show({ ...readyState, phase } as UpdateSnapshot);
    expect(document.body.querySelector('[role="dialog"]'), phase).toBeNull();
  }
});

it('答过就不再出现，但下一版下载完会重新问', async () => {
  await show(readyState);
  await act(async () => button('下次启动时提醒').click());
  // 推迟不改状态机，快照仍是 ready，弹窗不该再冒出来。
  await show(readyState);
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  await show({ ...readyState, phase: 'downloading', progress: 0.5 });
  await show({ ...readyState, version: '1.0.2' });
  expect(document.body.textContent).toContain('1.0.2');
});

it('保存与安装期间保持模态锁，Esc 不能解除', async () => {
  await show(readyState);
  await act(async () => useUpdateState.setState({ preparingInstall: true }));
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(0);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  await show({ ...readyState, phase: 'installing' });
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(0);
});
