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
