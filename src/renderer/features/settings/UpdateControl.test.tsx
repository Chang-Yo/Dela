// @vitest-environment jsdom
// 通用页更新入口的行为测试：快照来自共享 store，这里只验证渲染与动作派发。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, DocumentContent } from '../../../shared/api';
import type { UpdateSnapshot } from '../../../shared/update';
import { useToastStore } from '../../app/toasts';
import { useNoteDrafts, type NoteDraft } from '../../content/note/drafts';
import { UpdateControl } from './UpdateControl';
import { useUpdateState } from './update';

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

const draft: NoteDraft = {
  content: {} as unknown as DocumentContent,
  text: '还没落盘的正文',
  saved: '',
  saving: false,
  error: null,
};

let container: HTMLDivElement;
let root: Root;
let install: ReturnType<typeof vi.fn>;
let saveDraft: ReturnType<typeof vi.fn>;

function mountUpdateApi(overrides: Partial<DelaApi['update']> = {}) {
  window.dela = {
    update: {
      getState: async () => readyState,
      check: async () => readyState,
      download: async () => readyState,
      install,
      openDownloadPage: async () => {},
      onState: () => () => {},
      ...overrides,
    },
  } as unknown as DelaApi;
}

function button(text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  install = vi.fn(async () => readyState);
  saveDraft = vi.fn(async () => {
    useNoteDrafts.setState({ drafts: { 'notes/a.md': { ...draft, saved: draft.text } } });
    return true;
  });
  mountUpdateApi();
  useUpdateState.setState({ snapshot: readyState });
  useNoteDrafts.setState({
    drafts: { 'notes/a.md': draft },
    save: saveDraft as unknown as (key: string) => Promise<boolean>,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useUpdateState.setState({ snapshot: null, preparingInstall: false, dismissedVersion: null });
  useNoteDrafts.setState({ drafts: {} });
  useToastStore.setState({ toasts: [] });
  delete window.dela;
  vi.unstubAllGlobals();
});

it('安装入口重新打开确认弹窗，确认前不保存或退出', async () => {
  useUpdateState.setState({ dismissedVersion: readyState.version });
  await act(async () => root.render(<UpdateControl />));
  await act(async () => button('安装更新').click());
  expect(useUpdateState.getState().dismissedVersion).toBeNull();
  expect(saveDraft).not.toHaveBeenCalled();
  expect(install).not.toHaveBeenCalled();
});

it('下载不碰笔记，只有安装才需要冲盘', async () => {
  const download = vi.fn(async () => readyState);
  mountUpdateApi({ download });
  useUpdateState.setState({ snapshot: { ...readyState, phase: 'available' } });
  await act(async () => root.render(<UpdateControl />));
  await act(async () => button('下载更新').click());
  expect(download).toHaveBeenCalledTimes(1);
  expect(saveDraft).not.toHaveBeenCalled();
});

it('快照还没到手时不渲染任何东西（浏览器预览没有 preload 就是这种情况）', async () => {
  delete window.dela;
  useUpdateState.setState({ snapshot: null });
  await act(async () => root.render(<UpdateControl />));
  expect(container.textContent).toBe('');
});

it('平台尚未提供更新时说明限制，不显示检查、安装或 Windows 下载入口', async () => {
  useUpdateState.setState({
    snapshot: {
      ...readyState,
      phase: 'unsupported',
      reason: 'platform-unsupported',
      failedAt: 'check',
      version: null,
    },
  });
  await act(async () => root.render(<UpdateControl />));
  expect(container.querySelector('[role="status"]')?.textContent).toBeTruthy();
  expect(container.querySelector('button')).toBeNull();
});

it('常驻显示当前版本，未检查、开发运行这些状态下也不例外', async () => {
  for (const phase of ['idle', 'unsupported'] as const) {
    await act(async () => {
      useUpdateState.setState({ snapshot: { ...readyState, phase } });
      root.render(<UpdateControl />);
    });
    expect(container.textContent, phase).toContain('1.0.0');
  }
});

it('检查按钮用「暂停通知 30 分钟」那一档的 secondary，不再淡成看不出能点', async () => {
  await act(async () => {
    useUpdateState.setState({ snapshot: { ...readyState, phase: 'idle' } });
    root.render(<UpdateControl />);
  });
  // secondary 的底色是 hover-2；ghost 完全没有底色。
  expect(button('检查更新').className).toContain('bg-hover-2');
});

it('有更新可下载时升级成主色按钮', async () => {
  await act(async () => {
    useUpdateState.setState({ snapshot: { ...readyState, phase: 'available' } });
    root.render(<UpdateControl />);
  });
  expect(button('下载更新').className).toContain('bg-ink');
});

it('已下载与总大小在进度条左侧，百分比在右侧', async () => {
  useUpdateState.setState({
    snapshot: {
      ...readyState,
      phase: 'downloading',
      progress: 0.42,
      transferred: 42 * 1024 * 1024,
      total: 100 * 1024 * 1024,
    },
  });
  await act(async () => root.render(<UpdateControl />));
  const bar = container.querySelector('[role="progressbar"]')!;
  expect(bar.previousElementSibling?.textContent).toBe('42 MB / 100 MB');
  expect(bar.nextElementSibling?.textContent).toBe('42%');
  expect(bar.getAttribute('aria-valuenow')).toBe('42');
});

it('总大小未知时不伪造分母，停在 0%', async () => {
  useUpdateState.setState({
    snapshot: {
      ...readyState,
      phase: 'downloading',
      progress: 0,
      transferred: 0,
      total: null,
    },
  });
  await act(async () => root.render(<UpdateControl />));
  const bar = container.querySelector('[role="progressbar"]')!;
  expect(bar.previousElementSibling?.textContent).toBe('0 B / —');
  expect(bar.nextElementSibling?.textContent).toBe('0%');
});

it('百分比按字节计算，传输未完成时不提前进到 100%', async () => {
  useUpdateState.setState({
    snapshot: {
      ...readyState,
      phase: 'downloading',
      progress: 0.99,
      transferred: 103_809_024,
      total: 104_857_600,
    },
  });
  await act(async () => root.render(<UpdateControl />));
  const bar = container.querySelector('[role="progressbar"]')!;
  expect(bar.previousElementSibling?.textContent).toBe('99 MB / 100 MB');
  expect(bar.nextElementSibling?.textContent).toBe('99%');
  expect(bar.getAttribute('aria-valuenow')).toBe('99');
});
