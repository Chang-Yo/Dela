// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileChangeDetail, TurnChanges } from '../../../../core/protocol/agent';

// 契约客户端在模块加载时取 bridge，须先于导入卡片装好；各用例只重编程 handler。
const { api, dela } = vi.hoisted(() => {
  const api = {
    'agent:read-turn-changes': vi.fn<
      (input: {
        sessionId: string;
        turnId: string;
        includeStats: boolean;
      }) => Promise<TurnChanges | null>
    >(async () => null),
    'agent:read-turn-file-change': vi.fn<
      (input: {
        sessionId: string;
        turnId: string;
        path: string;
      }) => Promise<FileChangeDetail | null>
    >(async () => null),
    'chat:locateFile': vi.fn<(input: { sessionId: string; path: string }) => Promise<string>>(
      async () => 'E:\\workspace\\Test\\src\\app.ts',
    ),
    'chat:openInVsCode': vi.fn(async () => {}),
    'chat:revealFile': vi.fn(async () => {}),
  };
  const dela = {
    bridge: {
      invoke: (channel: string, input: never) => api[channel as keyof typeof api](input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  window.dela = dela;
  return { api, dela };
});
import { TurnChangesCard } from '../TurnChangesCard';
import { ChatTabSourceProvider } from '../chat-source';

// 落位行为由 workbench 的测试覆盖，这里只验证卡片交给工作台端口的动作。
const workbench = { open: vi.fn(), openDocument: vi.fn(), close: vi.fn() };

const sessionId = '0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4d';
let turnSeq = 0;

function turnFixture(overrides: Partial<TurnChanges> = {}): TurnChanges {
  turnSeq += 1;
  return {
    turnId: `0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4${turnSeq}`,
    cwd: 'E:\\workspace\\Test',
    startedAt: '2026-10-19T00:00:00Z',
    finishedAt: '2026-10-19T00:01:00Z',
    runStatus: 'completed',
    state: 'complete',
    warnings: [],
    files: [
      { path: 'src/app.ts', status: 'modified', beforeBytes: 10, afterBytes: 20, textDiff: true },
      { path: 'logo.png', status: 'added', beforeBytes: null, afterBytes: 5, textDiff: false },
    ],
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

async function renderCard(sessionId2: string, turnId: string, reviewEnabled = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ChatTabSourceProvider
          source={{
            navigate: () => false,
            workbench,
            opensLink: () => false,
            replyActions: [],
          }}
        >
          <TurnChangesCard sessionId={sessionId2} turnId={turnId} reviewEnabled={reviewEnabled} />
        </ChatTabSourceProvider>
      </QueryClientProvider>,
    ),
  );
  // 查询结果经 notifyManager 在下一个宏任务才通知组件。
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
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

it('审阅与打开按解析出的标签键落位，已删除文件的打开被禁用', async () => {
  const turn = turnFixture({
    files: [
      { path: 'src/app.ts', status: 'modified', beforeBytes: 1, afterBytes: 2, textDiff: true },
      { path: 'gone.log', status: 'deleted', beforeBytes: 3, afterBytes: null, textDiff: true },
    ],
  });
  api['agent:read-turn-changes'].mockImplementation(async () => turn);
  await renderCard(sessionId, turn.turnId);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());

  const review = host.querySelectorAll<HTMLButtonElement>('li button[type="button"]')[0]!;
  await act(async () => review.click());
  expect(workbench.open).toHaveBeenCalledWith(`review:${sessionId}:${turn.turnId}:src/app.ts`, {
    aside: true,
  });

  api['chat:locateFile'].mockResolvedValue('E:\\workspace\\Test\\src\\app.ts');
  const open = host.querySelector<HTMLButtonElement>('[title="在 Dela 中打开"]')!;
  await act(async () => open.click());
  expect(api['chat:locateFile']).toHaveBeenCalledWith({ sessionId, path: 'src/app.ts' });
  await act(async () => {});
  expect(workbench.openDocument).toHaveBeenCalledWith('E:\\workspace\\Test\\src\\app.ts', {
    aside: true,
  });

  const deletedOpen = host.querySelector<HTMLButtonElement>('[title="文件已删除"]')!;
  expect(deletedOpen.disabled).toBe(true);
});

it('随聊只列文件并提供打开，不读取 diff 详情或显示审阅与行数', async () => {
  const turn = turnFixture();
  api['agent:read-turn-changes'].mockImplementation(async () => turn);
  await renderCard(sessionId, turn.turnId, false);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());

  expect(host.querySelectorAll('li')).toHaveLength(2);
  expect(host.textContent).not.toContain('+2');
  expect(api['agent:read-turn-file-change']).not.toHaveBeenCalled();
  expect(api['agent:read-turn-changes']).toHaveBeenCalledWith({
    sessionId,
    turnId: turn.turnId,
    includeStats: false,
  });
  expect(host.querySelectorAll('[aria-label="选择打开方式"]')).toHaveLength(2);

  await act(async () => host.querySelector<HTMLButtonElement>('[title="在 Dela 中打开"]')!.click());
  expect(api['chat:locateFile']).toHaveBeenCalledWith({ sessionId, path: 'src/app.ts' });
  expect(workbench.openDocument).toHaveBeenCalledWith('E:\\workspace\\Test\\src\\app.ts', {
    aside: true,
  });
});
