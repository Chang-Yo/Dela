// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileChangeDetail } from '../../../../core/protocol/agent';
import type { UncommittedChanges } from '../../../../core/protocol/changes';

// 契约客户端在模块加载时取 bridge，须先于导入面板装好；各用例只重编程 handler。
const { api, dela } = vi.hoisted(() => {
  const api = {
    readUncommittedChanges: vi.fn<(sessionId: string) => Promise<UncommittedChanges>>(),
    readUncommittedFileChange:
      vi.fn<(input: { sessionId: string; path: string }) => Promise<FileChangeDetail>>(),
  };
  const dela = {
    bridge: {
      invoke: (channel: string, input: never) =>
        api[channel.slice('chat:'.length) as keyof typeof api](input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  window.dela = dela;
  return { api, dela };
});
import { UncommittedReview } from '../review/UncommittedReview';

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

let host: HTMLDivElement;
let root: Root;

let queryClient: QueryClient;

// 查询结果经 notifyManager 在下一个宏任务才通知组件。
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <UncommittedReview sessionId={sessionId} />
      </QueryClientProvider>,
    ),
  );
  // 列表读取与首文件详情是两段链路，各自落定一次。
  await settle();
  await settle();
}

beforeEach(() => {
  api.readUncommittedChanges.mockImplementation(async () => summaryFixture());
  api.readUncommittedFileChange.mockImplementation(async ({ path }) => detailOf(path));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.dela = dela;
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
  expect(api.readUncommittedFileChange).toHaveBeenCalledWith({ sessionId, path: 'src/app.ts' });
  expect(host.textContent).toContain('+src/app.ts');
});

it('非 Git 目录不读取文件详情', async () => {
  api.readUncommittedChanges.mockResolvedValue(
    summaryFixture({ available: false, reason: 'not-git', files: [] }),
  );
  await render();
  expect(api.readUncommittedFileChange).not.toHaveBeenCalled();
});

it('刷新重读列表；选中文件被移除时回落到第一个', async () => {
  // 前一个用例的 mockResolvedValue 会覆盖默认实现，这里显式恢复两文件基线。
  api.readUncommittedChanges.mockImplementation(async () => summaryFixture());
  await render();
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>('[aria-label="改动文件列表"] button:nth-child(2)')!
      .click();
  });
  await settle();
  expect(api.readUncommittedFileChange).toHaveBeenLastCalledWith({ sessionId, path: 'new.py' });

  api.readUncommittedChanges.mockResolvedValue(
    summaryFixture({
      files: [
        { path: 'gone.log', status: 'deleted', beforeBytes: 1, afterBytes: null, textDiff: true },
      ],
    }),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新改动"]')!.click());
  await settle();
  await settle();
  // 原选中项已不在列表：回落到第一个文件，而不是停留在一个无详情的失效选择上。
  expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('gone.log');
  expect(api.readUncommittedFileChange).toHaveBeenLastCalledWith({ sessionId, path: 'gone.log' });
});

it('刷新后选中文件不变也重新读取详情', async () => {
  await render();
  const calls = api.readUncommittedFileChange.mock.calls.length;
  api.readUncommittedFileChange.mockResolvedValue({
    ...detailOf('src/app.ts'),
    patch: '@@ -1,1 +1,1 @@\n-旧\n+刷新后的内容\n',
  });

  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新改动"]')!.click());
  await settle();
  await settle();
  expect(api.readUncommittedFileChange).toHaveBeenCalledTimes(calls + 1);
  expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('app.ts');
  expect(host.textContent).toContain('刷新后的内容');
});

it('读取不完整且没有文件时展示扫描警告', async () => {
  api.readUncommittedChanges.mockResolvedValue(
    summaryFixture({ files: [], warnings: ['src/app.ts: 无法读取'] }),
  );
  await render();
  expect(host.textContent).toContain('src/app.ts: 无法读取');
});

it('部分文件可读取时仍展示扫描警告和可用差异', async () => {
  api.readUncommittedChanges.mockResolvedValue(
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
  expect(api.readUncommittedFileChange).toHaveBeenCalledTimes(2);
  expect(api.readUncommittedChanges).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('+src/app.ts');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新改动"]')!.click());
  await settle();
  expect(api.readUncommittedFileChange).toHaveBeenCalledTimes(3);
  await selectFile(2);
  expect(api.readUncommittedFileChange).toHaveBeenCalledTimes(4);
});

it('面板卸载后不保留已查看的缓存', async () => {
  await render();
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(api.readUncommittedFileChange).toHaveBeenCalledTimes(2);
});

it('缓存超过总量限制时淘汰最早文件', async () => {
  api.readUncommittedFileChange.mockImplementation(async ({ path }) => ({
    ...detailOf(path),
    patch: 'x'.repeat(5 * 1024 * 1024),
  }));
  await render();
  await selectFile(2);
  await selectFile(1);
  expect(api.readUncommittedFileChange).toHaveBeenCalledTimes(3);
});

it('刷新前未完成的详情不覆盖刷新后的结果或进入新缓存', async () => {
  let resolveOld!: (value: FileChangeDetail) => void;
  api.readUncommittedFileChange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  await render();
  api.readUncommittedFileChange.mockImplementation(async ({ path }) => ({
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
  expect(api.readUncommittedFileChange).toHaveBeenCalledTimes(3);
});
