// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceChat } from '../../../shared/api';
import { ChatThread } from './ChatThread';

// jsdom 不排版；只替换 Markdown 渲染和浏览器尺寸边界，滚动逻辑使用真实组件。
vi.mock('./markdown', () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('framer-motion', () => ({ useReducedMotion: () => true }));

let host: HTMLDivElement;
let root: Root;
let messageHeight: number;
let scrollTop: number;
let notifyResize: () => void;
let nextFrame: FrameRequestCallback | undefined;

const chat: WorkspaceChat = {
  sessionId: 'test-session',
  running: true,
  configured: true,
  providerName: null,
  model: 'test-model',
  models: [],
  effortLevels: [],
  effort: null,
  messages: [
    { role: 'user', content: '检查滚动' },
    { role: 'assistant', content: '正在回答', startedAt: 1 },
  ],
};

const viewport = () => host.querySelector<HTMLDivElement>('[aria-label="对话消息"]')!;
const reserveHeight = () => {
  const content = viewport()?.firstElementChild;
  return [...(content?.children ?? [])].reduce(
    (height, child) => height + (parseFloat((child as HTMLElement).style.height) || 0),
    0,
  );
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  messageHeight = 1200;
  scrollTop = 0;
  nextFrame = undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    nextFrame = undefined;
  });
  vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '24px', fontSize: '16px' }));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return parseFloat(this.style.height) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    const height = messageHeight + reserveHeight();
    return this.getAttribute('aria-label') === '对话消息' ? Math.max(640, height) : height;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(() => scrollTop);
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (
    this: HTMLElement,
    value,
  ) {
    scrollTop = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
  });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0);
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function resizeTo(height: number) {
  messageHeight = height;
  await act(async () => {
    notifyResize();
    const frame = nextFrame;
    nextFrame = undefined;
    frame?.(0);
  });
}

it('工作过程收起时跟随实际消息底部，不用空白保留旧滚动位置', async () => {
  await act(async () => root.render(<ChatThread chat={chat} />));
  expect(viewport().scrollTop).toBe(560);
  await resizeTo(300);
  expect(viewport().scrollHeight).toBe(640);
  expect(viewport().scrollTop).toBe(0);
  for (let index = 0; index < 3; index += 1) await resizeTo(300);
  expect(viewport().scrollHeight).toBe(640);
  expect(viewport().scrollTop).toBe(0);
});

it('用户上滚后流式增长不抢位置，回到底部后恢复跟随', async () => {
  await act(async () => root.render(<ChatThread chat={chat} />));
  await act(async () => {
    viewport().scrollTop = 200;
    viewport().dispatchEvent(new Event('scroll'));
  });
  await resizeTo(1400);
  expect(viewport().scrollTop).toBe(200);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="回到底部"]')!.click());
  expect(viewport().scrollTop).toBe(760);
  await resizeTo(1600);
  expect(viewport().scrollTop).toBe(960);
});

it('重复尺寸通知不改变滚动范围，卸载后取消待处理的滚动', async () => {
  await act(async () => root.render(<ChatThread chat={chat} />));
  for (let index = 0; index < 3; index += 1) await resizeTo(1200);
  expect(viewport().scrollHeight).toBe(1200);
  expect(viewport().scrollTop).toBe(560);
  notifyResize();
  expect(nextFrame).toBeDefined();
  await act(async () => root.render(null));
  expect(nextFrame).toBeUndefined();
});

it('同索引编辑重发的新回复就位时重新跟随，而不是依赖 running 再次变化', async () => {
  await act(async () => root.render(<ChatThread chat={chat} />));
  await act(async () => {
    viewport().scrollTop = 200;
    viewport().dispatchEvent(new Event('scroll'));
  });
  const restarted: WorkspaceChat = {
    ...chat,
    messages: [chat.messages[0]!, { role: 'assistant', content: '新的回复', startedAt: 2 }],
  };
  await act(async () => root.render(<ChatThread chat={restarted} />));
  expect(viewport().scrollTop).toBe(560);
});

it('查看工作过程暂停贴底，展开和后续流式增长不会将过程入口推离视线', async () => {
  const traced: WorkspaceChat = {
    ...chat,
    messages: [
      chat.messages[0]!,
      {
        role: 'assistant',
        content: '',
        startedAt: 1,
        parts: [
          {
            type: 'tools',
            results: [{ id: 'tool-1', name: 'search_sources', input: { query: '课件' } }],
          },
        ],
      },
    ],
  };
  await act(async () => root.render(<ChatThread chat={traced} />));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  await act(async () => trigger.click());
  await act(async () => trigger.click());
  await resizeTo(1600);
  expect(viewport().scrollTop).toBe(560);
  await resizeTo(1800);
  expect(viewport().scrollTop).toBe(560);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="回到底部"]')!.click());
  await resizeTo(2000);
  expect(viewport().scrollTop).toBe(1360);
});

it('正文始终在过程区外，同索引重发会重置过程展开状态', async () => {
  const traced: WorkspaceChat = {
    ...chat,
    messages: [
      chat.messages[0]!,
      {
        role: 'assistant',
        content: '这是回答',
        startedAt: 1,
        parts: [
          { type: 'reasoning', text: '核对资料的过程' },
          { type: 'text', text: '这是回答' },
        ],
      },
    ],
  };
  await act(async () => root.render(<ChatThread chat={traced} />));
  expect(host.textContent).toContain('这是回答');
  expect(host.textContent).toContain('核对资料的过程');
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).not.toContain('这是回答');
  await act(async () => trigger.click());
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...traced,
          messages: [traced.messages[0]!, { ...traced.messages[1]!, startedAt: 2 }],
        }}
      />,
    ),
  );
  expect(host.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
});

it('正文从首个字到工具调用及结束均保持同一容器，中间文字不隐藏或搬移', async () => {
  const reply: WorkspaceChat['messages'][number] = {
    role: 'assistant',
    content: '我来核对一下',
    startedAt: 1,
    parts: [{ type: 'text', text: '我来核对一下' }],
  };
  const renderReply = async (message: typeof reply, running = true) => {
    await act(async () =>
      root.render(
        <ChatThread chat={{ ...chat, running, messages: [chat.messages[0]!, message] }} />,
      ),
    );
  };
  await renderReply(reply);
  const body = host.querySelector('[data-assistant-body]');
  expect(body).not.toBeNull();
  expect(body?.textContent).toContain('我来核对一下');
  expect(host.querySelector('[aria-label="工作过程"]')).toBeNull();
  const toolPart = {
    type: 'tools' as const,
    results: [{ id: 'tool-1', name: 'search_sources', input: {}, output: { ok: true } }],
  };
  const afterTool = { ...reply, parts: [...reply.parts!, toolPart] };
  await renderReply(afterTool);
  expect(host.querySelector('[data-assistant-body]')).toBe(body);
  expect(body?.textContent).toContain('我来核对一下');
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).not.toContain('我来核对一下');
  expect(
    body!.compareDocumentPosition(host.querySelector('[aria-label="工作过程"]')!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const finalReply = {
    ...afterTool,
    content: '我来核对一下\n\n核对结果',
    parts: [...afterTool.parts, { type: 'text' as const, text: '核对结果' }],
  };
  await renderReply(finalReply);
  expect(host.querySelectorAll('[data-assistant-body]')[1]?.textContent).toContain('核对结果');
  await renderReply({ ...finalReply, finishedAt: 100 }, false);
  expect(host.querySelector('[aria-label="工作过程"]')).toBeNull();
  expect(host.textContent).toContain('核对结果');
  expect(host.querySelector('[data-assistant-body]')).toBe(body);
  expect(body?.textContent).toContain('我来核对一下');
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).not.toContain('我来核对一下');
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).not.toContain('核对结果');
});

it.each(['stopped', 'interrupted'] as const)(
  '%s 保留已输出的正文及明确状态，不将文字收入折叠过程',
  async (status) => {
    await act(async () =>
      root.render(
        <ChatThread
          chat={{
            ...chat,
            running: false,
            messages: [
              chat.messages[0]!,
              {
                role: 'assistant',
                content: '尚未完成的片段',
                startedAt: 1,
                finishedAt: 100,
                [status]: true,
                parts: [{ type: 'text', text: '尚未完成的片段' }],
              },
            ],
          }}
        />,
      ),
    );
    expect(host.querySelector('[data-assistant-body]')?.textContent).toContain('尚未完成的片段');
    expect(host.textContent).toContain(status === 'stopped' ? '已停止' : '执行中断');
    expect(host.querySelector('[aria-label="工作过程"]')).toBeNull();
  },
);
