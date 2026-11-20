// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceChat } from '../../../../core/protocol/agent';
import { ChatThread } from '../ChatThread';

// jsdom 不排版：Markdown 渲染与改动卡片换成占位，尺寸与滚动边界用最小桩。
vi.mock('../markdown', () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('../../../../ui/hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('../TurnChangesCard', () => ({
  TurnChangesCard: ({ turnId }: { turnId: string }) => <div data-turn-card={turnId} />,
}));

let host: HTMLDivElement;
let root: Root;

const chat: WorkspaceChat = {
  sessionId: 'test-session',
  projectId: null,
  cwd: null,
  running: true,
  configured: true,
  providerId: null,
  providerName: null,
  model: 'test-model',
  modelUnavailable: false,
  effortLevels: [],
  effort: null,
  messages: [
    { role: 'user', content: '检查滚动' },
    { role: 'assistant', content: '正在回答', startedAt: 1 },
  ],
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  HTMLElement.prototype.scrollTo = () => {};
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('整轮失败显示错误卡与重试，重试以原文重发', async () => {
  const onEditLast = vi.fn();
  await act(async () =>
    root.render(
      <ChatThread
        onEditLast={onEditLast}
        chat={{
          ...chat,
          running: false,
          messages: [
            chat.messages[0]!,
            {
              role: 'assistant',
              content: '本次执行中断：模型请求失败（HTTP 401）',
              interrupted: true,
              startedAt: 1,
              finishedAt: 2,
              parts: [{ type: 'text', text: '本次执行中断：模型请求失败（HTTP 401）' }],
            },
          ],
        }}
      />,
    ),
  );
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain('HTTP 401');
  await act(async () => alert.querySelector('button')!.click());
  expect(onEditLast).toHaveBeenCalledWith('检查滚动', undefined);
});

it('插队把一轮切成多段回复时，本轮改动卡片只挂在最后一段', async () => {
  const turnId = 'turn-1';
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...chat,
          running: false,
          messages: [
            { role: 'user', content: '先做 A', turnId },
            {
              role: 'assistant',
              content: '在做 A',
              startedAt: 1,
              finishedAt: 2,
              turnId,
              parts: [{ type: 'text', text: '在做 A' }],
            },
            { role: 'user', content: '顺便做 B', turnId },
            {
              role: 'assistant',
              content: 'A 和 B 都做完了',
              startedAt: 3,
              finishedAt: 4,
              turnId,
              parts: [{ type: 'text', text: 'A 和 B 都做完了' }],
            },
          ],
        }}
      />,
    ),
  );
  const cards = [...host.querySelectorAll('[data-turn-card]')];
  expect(cards).toHaveLength(1);
  expect(cards[0]!.parentElement!.textContent).toContain('A 和 B 都做完了');
});
