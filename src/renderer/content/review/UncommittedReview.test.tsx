// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, FileChangeDetail, UncommittedChanges } from '../../../shared/api';
import { UncommittedReview } from './UncommittedReview';

const sessionId = '0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4d';

const detailOf = (path: string): FileChangeDetail => ({
  path,
  status: 'modified',
  beforeBytes: 1,
  afterBytes: 2,
  textDiff: true,
  before: '旧\n',
  after: '新\n',
  patch: `@@ -1,1 +1,1 @@\n-旧\n+${path}\n`,
  note: null,
});

function summaryFixture(overrides: Partial<UncommittedChanges> = {}): UncommittedChanges {
  return {
    available: true,
    reason: null,
    cwd: 'E:\\workspace\\Test',
    repositoryRoot: 'E:\\workspace\\Test',
    head: '812a85afe35c1c1ea9b4b2a56dd7aa4f33254f10',
    warnings: [],
    files: [
      { path: 'src/app.ts', status: 'modified', beforeBytes: 10, afterBytes: 20, textDiff: true },
      { path: 'new.py', status: 'added', beforeBytes: null, afterBytes: 5, textDiff: true },
    ],
    ...overrides,
  };
}

const dela = {
  chat: {
    readUncommittedChanges: vi.fn<(s: string) => Promise<UncommittedChanges>>(async () =>
      summaryFixture(),
    ),
    readUncommittedFileChange: vi.fn<(s: string, p: string) => Promise<FileChangeDetail>>(
      async (_s, path) => detailOf(path),
    ),
  },
};

let host: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => root.render(<UncommittedReview sessionId={sessionId} />));
  // 列表读取与首文件详情是两段链路，多轮微任务落定。
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  dela.chat.readUncommittedChanges.mockImplementation(async () => summaryFixture());
  dela.chat.readUncommittedFileChange.mockImplementation(async (_s, path) => detailOf(path));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.dela = dela as unknown as DelaApi;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.dela;
  vi.clearAllMocks();
});

it('列出改动文件并自动选中第一个，右侧呈现其差异', async () => {
  await render();
  expect(host.textContent).toContain('app.ts');
  expect(host.textContent).toContain('new.py');
  expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('app.ts');
  expect(dela.chat.readUncommittedFileChange).toHaveBeenCalledWith(sessionId, 'src/app.ts');
  expect(host.textContent).toContain('+src/app.ts');
});

it('非 Git 目录不读取文件详情', async () => {
  dela.chat.readUncommittedChanges.mockResolvedValue(
    summaryFixture({ available: false, reason: 'not-git', files: [] }),
  );
  await render();
  expect(dela.chat.readUncommittedFileChange).not.toHaveBeenCalled();
});

it('刷新重读列表；选中文件被移除时回落到第一个', async () => {
  // 前一个用例的 mockResolvedValue 会覆盖默认实现，这里显式恢复两文件基线。
  dela.chat.readUncommittedChanges.mockImplementation(async () => summaryFixture());
  await render();
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>('[aria-label="改动文件列表"] button:nth-child(2)')!
      .click();
  });
  await act(async () => {});
  expect(dela.chat.readUncommittedFileChange).toHaveBeenLastCalledWith(sessionId, 'new.py');

  dela.chat.readUncommittedChanges.mockResolvedValue(
    summaryFixture({
      files: [
        { path: 'gone.log', status: 'deleted', beforeBytes: 1, afterBytes: null, textDiff: true },
      ],
    }),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新改动"]')!.click());
  await act(async () => {});
  await act(async () => {});
  // 原选中项已不在列表：回落到第一个文件，而不是停留在一个无详情的失效选择上。
  expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('gone.log');
  expect(dela.chat.readUncommittedFileChange).toHaveBeenLastCalledWith(sessionId, 'gone.log');
});

it('刷新后选中文件不变也重新读取详情', async () => {
  await render();
  const calls = dela.chat.readUncommittedFileChange.mock.calls.length;
  dela.chat.readUncommittedFileChange.mockResolvedValue({
    ...detailOf('src/app.ts'),
    patch: '@@ -1,1 +1,1 @@\n-旧\n+刷新后的内容\n',
  });

  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新改动"]')!.click());
  await act(async () => {});
  expect(dela.chat.readUncommittedFileChange).toHaveBeenCalledTimes(calls + 1);
  expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('app.ts');
  expect(host.textContent).toContain('刷新后的内容');
});

it('读取不完整且没有文件时展示扫描警告', async () => {
  dela.chat.readUncommittedChanges.mockResolvedValue(
    summaryFixture({ files: [], warnings: ['src/app.ts: 无法读取'] }),
  );
  await render();
  expect(host.textContent).toContain('src/app.ts: 无法读取');
});

it('部分文件可读取时仍展示扫描警告和可用差异', async () => {
  dela.chat.readUncommittedChanges.mockResolvedValue(
    summaryFixture({ warnings: ['变更超过 10,000 个文件，列表不完整'] }),
  );
  await render();
  expect(host.textContent).toContain('变更超过 10,000 个文件，列表不完整');
  expect(host.textContent).toContain('+src/app.ts');
});

async function selectFile(index: number) {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(`[aria-label="改动文件列表"] button:nth-child(${index})`)!
      .click(),
  );
}

it('切回已查看文件使用缓存，刷新清空所有缓存', async () => {
  await render();
  await selectFile(2);
  await selectFile(1);
  expect(dela.chat.readUncommittedFileChange).toHaveBeenCalledTimes(2);
  expect(dela.chat.readUncommittedChanges).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('+src/app.ts');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新改动"]')!.click());
  expect(dela.chat.readUncommittedFileChange).toHaveBeenCalledTimes(3);
  await selectFile(2);
  expect(dela.chat.readUncommittedFileChange).toHaveBeenCalledTimes(4);
});

it('面板卸载后不保留已查看的缓存', async () => {
  await render();
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(dela.chat.readUncommittedFileChange).toHaveBeenCalledTimes(2);
});

it('缓存超过总量限制时淘汰最早文件', async () => {
  dela.chat.readUncommittedFileChange.mockImplementation(async (_s, path) => ({
    ...detailOf(path),
    patch: 'x'.repeat(5 * 1024 * 1024),
  }));
  await render();
  await selectFile(2);
  await selectFile(1);
  expect(dela.chat.readUncommittedFileChange).toHaveBeenCalledTimes(3);
});

it('刷新前未完成的详情不覆盖刷新后的结果或进入新缓存', async () => {
  let resolveOld!: (value: FileChangeDetail) => void;
  dela.chat.readUncommittedFileChange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  await render();
  dela.chat.readUncommittedFileChange.mockImplementation(async (_s, path) => ({
    ...detailOf(path),
    patch: '@@ -1,1 +1,1 @@\n-old\n+fresh\n',
  }));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新改动"]')!.click());
  await act(async () =>
    resolveOld({
      ...detailOf('src/app.ts'),
      patch: '@@ -1,1 +1,1 @@\n-old\n+stale\n',
    }),
  );
  await selectFile(2);
  await selectFile(1);
  expect(host.textContent).toContain('+fresh');
  expect(host.textContent).not.toContain('+stale');
  expect(dela.chat.readUncommittedFileChange).toHaveBeenCalledTimes(3);
});
