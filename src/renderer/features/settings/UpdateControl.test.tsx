// @vitest-environment jsdom
// 通用页更新入口的行为测试：快照来自共享 store，这里只验证渲染与动作派发。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, DocumentContent } from '../../../shared/api';
import type { UpdateSnapshot } from '../../../shared/update';
import { useToastStore } from '../../app/toasts';
import { useNoteDrafts, type NoteDraft } from '../../workspace/drafts';
import { UpdateControl } from './UpdateControl';
import { useUpdateState } from './update-state';

vi.mock('../../content/note/NoteEditor', () => ({ flushNoteEditors: vi.fn() }));

const readyState: UpdateSnapshot = {
  phase: 'ready',
  currentVersion: '1.0.0',
  version: '1.0.1',
  progress: 1,
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
  useUpdateState.setState({ snapshot: null, preparingInstall: false });
  useNoteDrafts.setState({ drafts: {} });
  useToastStore.setState({ toasts: [] });
  delete window.dela;
  vi.unstubAllGlobals();
});

it('安装前先把未落盘的笔记冲一次，再交给系统安装', async () => {
  await act(async () => root.render(<UpdateControl />));
  await act(async () => button('安装更新').click());
  expect(saveDraft).toHaveBeenCalledWith('notes/a.md');
  expect(install).toHaveBeenCalledTimes(1);
});

it('有笔记没保存成功就不安装：安装会结束进程，宁可先让用户处理', async () => {
  saveDraft.mockResolvedValue(false);
  await act(async () => root.render(<UpdateControl />));
  await act(async () => button('安装更新').click());
  expect(install).not.toHaveBeenCalled();
  expect(useToastStore.getState().toasts[0]?.variant).toBe('error');
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

it('不拿 IPC 的返回值改写快照：状态只认主进程广播', async () => {
  install = vi.fn(async () => ({ ...readyState, phase: 'installing' }));
  mountUpdateApi();
  await act(async () => root.render(<UpdateControl />));
  await act(async () => button('安装更新').click());
  expect(useUpdateState.getState().snapshot).toEqual(readyState);
});

it('快照还没到手时不渲染任何东西（浏览器预览没有 preload 就是这种情况）', async () => {
  delete window.dela;
  useUpdateState.setState({ snapshot: null });
  await act(async () => root.render(<UpdateControl />));
  expect(container.textContent).toBe('');
});

it('常驻显示当前版本，未检查、开发运行这些状态下也不例外', async () => {
  for (const phase of ['idle', 'unsupported'] as const) {
    await act(async () => {
      useUpdateState.setState({ snapshot: { ...readyState, phase } });
      root.render(<UpdateControl />);
    });
    expect(container.textContent, phase).toContain('当前版本 1.0.0');
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
