// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../shared/api';
import type { CanvasDownload } from '../../shared/canvas';
import { CanvasDownloadsPanel } from './CanvasDownloadsPanel';
import { SourcesTree } from './SourcesTree';
import { useWorkspaceStore } from '../workspace/store';

let host: HTMLDivElement;
let root: Root;
const stopBlur = (event: Event) => event.stopImmediatePropagation();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.addEventListener('blur', stopBlur, true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.dela;
  window.removeEventListener('blur', stopBlur, true);
  vi.unstubAllGlobals();
});

it('课程和无 sourceId 的文件夹都能从菜单启动批量下载', async () => {
  useWorkspaceStore.getState().setCanvas({
    connected: true,
    syncedAt: null,
    courses: [
      { id: 1, name: '示例课', term: '2026 Fall', code: '', syncedAt: '2026-10-18', error: null },
    ],
    items: [
      {
        id: '1:modules',
        courseId: 1,
        name: '课程模块',
        parentId: null,
        kind: 'folder',
        sourceId: null,
      },
    ],
  });
  const onDownload = vi.fn();
  await act(async () =>
    root.render(
      <SourcesTree
        bySource={false}
        expanded={['term:2026 Fall', 'course:1']}
        selected={null}
        query=""
        onExpand={vi.fn()}
        onOpen={vi.fn()}
        onLink={vi.fn()}
        onDownload={onDownload}
      />,
    ),
  );
  for (const [name, label, itemId] of [
    ['示例课', '下载整门课程', undefined],
    ['课程模块', '下载此文件夹', '1:modules'],
  ]) {
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(`button[aria-label="${name} 的操作"]`)!
        .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent === label,
    )!;
    expect(item).toBeTruthy();
    await act(async () => item.click());
    expect(onDownload).toHaveBeenLastCalledWith(1, itemId);
  }
});

it('展示成功失败明细，单个失败项仅重试自身，卸载后取消订阅', async () => {
  const unsubscribe = vi.fn();
  const retryDownload = vi.fn(async () => {});
  const downloads: CanvasDownload[] = [
    {
      id: 'job',
      title: '示例课',
      directory: '/exports/示例课 [1]',
      state: 'completed',
      files: [
        { sourceId: 'file:1', path: '文件/a.pdf', state: 'completed' },
        { sourceId: 'file:2', path: '文件/b.pdf', state: 'failed', error: '无权访问' },
      ],
    },
  ];
  window.dela = {
    canvas: {
      downloads: async () => downloads,
      onDownloadsChanged: () => unsubscribe,
      retryDownload,
    },
  } as unknown as DelaApi;
  await act(async () => root.render(<CanvasDownloadsPanel open onOpenChange={vi.fn()} />));
  expect(document.body.textContent).toContain('成功 1 · 失败 1 · 未完成 0');
  expect(document.body.textContent).toContain('无权访问');
  expect(document.body.textContent).toContain('同名文件覆盖保存');
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="重试 文件/b.pdf"]')!.click(),
  );
  expect(retryDownload).toHaveBeenCalledExactlyOnceWith('job', 'file:2');
  await act(async () => root.render(null));
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('进度推送可更新面板，进行中不允许重试，停止按钮发出指定任务请求', async () => {
  let receive!: (tasks: CanvasDownload[]) => void;
  const stopDownload = vi.fn(async () => {});
  window.dela = {
    canvas: {
      downloads: async () => [],
      onDownloadsChanged: (listener: typeof receive) => {
        receive = listener;
        return () => {};
      },
      stopDownload,
    },
  } as unknown as DelaApi;
  await act(async () => root.render(<CanvasDownloadsPanel open onOpenChange={vi.fn()} />));
  await act(async () =>
    receive([
      {
        id: 'job',
        title: '示例课',
        directory: '/exports',
        state: 'downloading',
        files: [
          { sourceId: 'file:1', path: 'a.pdf', state: 'failed', error: '离线' },
          { sourceId: 'file:2', path: 'b.pdf', state: 'downloading' },
        ],
      },
    ]),
  );
  expect(document.body.textContent).toContain('下载中 · 1/2');
  expect(document.querySelector<HTMLButtonElement>('[aria-label="重试 a.pdf"]')!.disabled).toBe(
    true,
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="停止下载 示例课"]')!.click(),
  );
  expect(stopDownload).toHaveBeenCalledExactlyOnceWith('job');
});
