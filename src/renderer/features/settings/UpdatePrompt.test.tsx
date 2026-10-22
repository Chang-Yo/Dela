// @vitest-environment jsdom
// 下载完成与设置入口共用确认弹窗，退出前保存并说明会结束终端任务。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, DocumentContent } from '../../../shared/api';
import type { UpdateSnapshot } from '../../../shared/update';
import { useToastStore } from '../../app/toasts';
import { useNoteDrafts, type NoteDraft } from '../../content/note/drafts';
import { UpdatePrompt } from './UpdatePrompt';
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
let deferInstall: ReturnType<typeof vi.fn>;
let saveDraft: ReturnType<typeof vi.fn>;

function mountUpdateApi() {
  window.dela = {
    update: {
      getState: async () => readyState,
      check: async () => readyState,
      download: async () => readyState,
      install,
      deferInstall,
      openDownloadPage: async () => {},
      onState: () => () => {},
    },
  } as unknown as DelaApi;
}

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
  install = vi.fn(async () => ({ ...readyState, phase: 'installing' }));
  deferInstall = vi.fn(async () => {});
  saveDraft = vi.fn(async () => {
    useNoteDrafts.setState({ drafts: { 'notes/a.md': { ...draft, saved: draft.text } } });
    return true;
  });
  mountUpdateApi();
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

it('只有下载完成才弹：其它阶段都不打扰用户', async () => {
  const quiet = ['idle', 'checking', 'up-to-date', 'available', 'downloading'];
  for (const phase of quiet) {
    await show({ ...readyState, phase } as UpdateSnapshot);
    expect(document.body.querySelector('[role="dialog"]'), phase).toBeNull();
  }
});

it('选「下次启动时提醒」只记标记，不安装', async () => {
  await show(readyState);
  await act(async () => button('下次启动时提醒').click());
  expect(deferInstall).toHaveBeenCalledTimes(1);
  expect(install).not.toHaveBeenCalled();
  expect(saveDraft).not.toHaveBeenCalled();
});

it('选「退出并安装」先冲草稿再安装', async () => {
  await show(readyState);
  await act(async () => button('退出并安装').click());
  expect(saveDraft).toHaveBeenCalledWith('notes/a.md');
  expect(install).toHaveBeenCalledTimes(1);
  expect(deferInstall).not.toHaveBeenCalled();
});

it('笔记没冲成功就不安装，也不静默丢掉这次更新', async () => {
  saveDraft.mockResolvedValue(false);
  await show(readyState);
  await act(async () => button('退出并安装').click());
  expect(install).not.toHaveBeenCalled();
  expect(useToastStore.getState().toasts[0]?.variant).toBe('error');
  expect(document.body.textContent).toContain('退出并安装');
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

it('按 Esc 只是关掉弹窗，不替用户决定装还是等', async () => {
  await show(readyState);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(install).not.toHaveBeenCalled();
  expect(deferInstall).not.toHaveBeenCalled();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
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

it('关闭提示后从设置安装会再次确认，不直接退出', async () => {
  await show(readyState);
  await act(async () => button('下次启动时提醒').click());
  await act(async () =>
    root.render(
      <>
        <UpdateControl />
        <UpdatePrompt />
      </>,
    ),
  );
  expect(document.body.textContent).not.toContain('退出并安装');
  await act(async () => button('安装更新').click());
  expect(document.body.textContent).toContain('退出并安装');
  expect(install).not.toHaveBeenCalled();
  expect(saveDraft).not.toHaveBeenCalled();
  await act(async () => button('退出并安装').click());
  expect(install).toHaveBeenCalledTimes(1);
});

it('推迟提醒保存失败时保留确认弹窗', async () => {
  deferInstall.mockRejectedValueOnce(new Error('ipc down'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await show(readyState);
  await act(async () => button('下次启动时提醒').click());
  expect(document.body.textContent).toContain('退出并安装');
  expect(useToastStore.getState().toasts[0]?.variant).toBe('error');
  vi.restoreAllMocks();
});

it('100% 下载状态不提前弹，ready 后才显示退出安装确认', async () => {
  await show({ ...readyState, phase: 'downloading', progress: 1 });
  expect(document.body.textContent).not.toContain('退出并安装');
  await show(readyState);
  expect(document.body.textContent).toContain('退出并安装');
});
