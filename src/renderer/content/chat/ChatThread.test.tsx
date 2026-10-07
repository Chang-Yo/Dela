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
