// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceChat } from '../../../shared/api';
import { setChatMediaPreview } from './media';
import { ChatThread } from './ChatThread';

// jsdom 不排版；只替换 Markdown 渲染和浏览器尺寸边界，滚动逻辑使用真实组件。
const motion = vi.hoisted(() => ({ reduced: true }));
vi.mock('./markdown', () => ({
  ChatMarkdown: ({
    children,
    mode,
    animated,
  }: {
    children: ReactNode;
    mode?: 'static' | 'streaming';
    animated?: boolean | object;
  }) => (
    <span data-animated={animated ? 'true' : 'false'} data-markdown-mode={mode ?? 'unset'}>
      {children}
    </span>
  ),
}));
vi.mock('framer-motion', () => ({ useReducedMotion: () => motion.reduced }));

let host: HTMLDivElement;
let root: Root;
let messageHeight: number;
let scrollTop: number;
let notifyResize: () => void;
let nextFrame: FrameRequestCallback | undefined;

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
  motion.reduced = true;
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
            results: [{ id: 'tool-1', name: 'read', input: { path: '课件.md' } }],
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

it('思考默认收起，正文始终可见', async () => {
  const traced: WorkspaceChat = {
    ...chat,
    running: false,
    messages: [
      chat.messages[0]!,
      {
        role: 'assistant',
        content: '这是回答',
        startedAt: 1,
        finishedAt: 2,
        parts: [
          { type: 'reasoning', text: '核对资料的过程' },
          { type: 'text', text: '这是回答' },
        ],
      },
    ],
  };
  await act(async () => root.render(<ChatThread chat={traced} />));
  expect(host.textContent).toContain('这是回答');
  expect(host.textContent).not.toContain('核对资料的过程');
  // 结束后先展开折叠的过程，再展开思考。
  await act(async () => host.querySelector<HTMLButtonElement>('[data-trace-toggle]')!.click());
  const thought = [...host.querySelectorAll<HTMLButtonElement>('[data-trace-toggle]')][1]!;
  await act(async () => thought.click());
  expect(host.textContent).toContain('核对资料的过程');
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

it('正文从首个字到工具调用及结束均保持同一节点，工具行出现在其后', async () => {
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
  const body = host.querySelector('[data-assistant-body]')!;
  expect(body.textContent).toContain('我来核对一下');
  const toolPart = {
    type: 'tools' as const,
    results: [{ id: 'tool-1', name: 'grep', input: {}, output: { text: '' }, finishedAt: 2 }],
  };
  const afterTool = { ...reply, parts: [...reply.parts!, toolPart] };
  await renderReply(afterTool);
  expect(host.querySelector('[data-assistant-body]')).toBe(body);
  const step = host.querySelector('[data-trace-toggle]')!;
  expect(body.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const finalReply = {
    ...afterTool,
    content: '我来核对一下\n\n核对结果',
    parts: [...afterTool.parts, { type: 'text' as const, text: '核对结果' }],
  };
  await renderReply(finalReply);
  const answer = host.querySelectorAll('[data-assistant-body]')[1]!;
  expect(answer.textContent).toBe('核对结果');
  // 结束：中间说明与工具折叠，最终回复节点保持不变且可见。
  await renderReply({ ...finalReply, finishedAt: 100 }, false);
  expect(host.querySelectorAll('[data-assistant-body]')[1]).toBe(answer);
  expect(answer.closest('[hidden]')).toBeNull();
  expect(host.querySelector('[data-assistant-body]')!.closest('[hidden]')).not.toBeNull();
});

it('停止的回复保留已输出正文', async () => {
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
              stopped: true,
              parts: [{ type: 'text', text: '尚未完成的片段' }],
            },
          ],
        }}
      />,
    ),
  );
  expect(host.querySelector('[data-assistant-body]')?.textContent).toBe('尚未完成的片段');
});

it('流式期间使用 streaming，消息结束后切回 static', async () => {
  const user = { role: 'user' as const, content: '问题' };
  const parts = [{ type: 'text' as const, text: '回答' }];
  const liveChat: WorkspaceChat = {
    ...chat,
    running: true,
    messages: [user, { role: 'assistant', content: '回答', startedAt: 1, parts }],
  };
  await act(async () => root.render(<ChatThread chat={liveChat} />));
  expect(
    host
      .querySelector('[data-assistant-body] [data-markdown-mode]')
      ?.getAttribute('data-markdown-mode'),
  ).toBe('streaming');

  const doneChat: WorkspaceChat = {
    ...liveChat,
    running: false,
    messages: [user, { role: 'assistant', content: '回答', startedAt: 1, finishedAt: 2, parts }],
  };
  await act(async () => root.render(<ChatThread chat={doneChat} />));
  expect(
    host
      .querySelector('[data-assistant-body] [data-markdown-mode]')
      ?.getAttribute('data-markdown-mode'),
  ).toBe('static');
});

it('用户消息始终按 static 渲染，不经过 remend', async () => {
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...chat,
          running: false,
          messages: [
            { role: 'user', content: 'd <dsadsa dsadsa' },
            {
              role: 'assistant',
              content: '回复',
              startedAt: 1,
              finishedAt: 2,
              parts: [{ type: 'text', text: '回复' }],
            },
          ],
        }}
      />,
    ),
  );
  expect(host.querySelector('[data-markdown-mode]')?.getAttribute('data-markdown-mode')).toBe(
    'static',
  );
});

it('切回标签等重挂载时，已在输出的正文不重播渐入动画', async () => {
  motion.reduced = false;
  const user = { role: 'user' as const, content: '问题' };
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...chat,
          running: true,
          messages: [
            user,
            {
              role: 'assistant',
              content: '已输出',
              startedAt: 1,
              parts: [{ type: 'text', text: '已输出' }],
            },
          ],
        }}
      />,
    ),
  );
  expect(
    host.querySelector('[data-assistant-body] [data-animated]')?.getAttribute('data-animated'),
  ).toBe('false');
});

it('挂载时回复尚无正文，后续输出仍启用渐入动画', async () => {
  motion.reduced = false;
  const user = { role: 'user' as const, content: '问题' };
  const waiting: WorkspaceChat = {
    ...chat,
    running: true,
    messages: [user, { role: 'assistant', content: '', parts: [], startedAt: 1 }],
  };
  await act(async () => root.render(<ChatThread chat={waiting} />));
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...waiting,
          messages: [
            user,
            {
              role: 'assistant',
              content: '回答',
              startedAt: 1,
              parts: [{ type: 'text', text: '回答' }],
            },
          ],
        }}
      />,
    ),
  );
  expect(
    host.querySelector('[data-assistant-body] [data-animated]')?.getAttribute('data-animated'),
  ).toBe('true');
});

it('用户消息的图片缩略图点击放大，点击遮罩或 Esc 关闭', async () => {
  setChatMediaPreview('img-1', 'data:image/png;base64,QUJD');
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...chat,
          messages: [
            { role: 'user', content: '看这张图', images: [{ id: 'img-1', name: '01.png' }] },
          ],
        }}
      />,
    ),
  );
  const thumb = host.querySelector('img[alt="01.png"]');
  expect(thumb).not.toBeNull();
  await act(async () => (thumb!.parentElement as HTMLButtonElement).click());
  let dialog = document.body.querySelector('[role="dialog"][aria-label="图片查看"]');
  expect(dialog).not.toBeNull();
  expect(dialog!.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
  await act(async () => (dialog as HTMLDivElement).click());
  expect(document.body.querySelector('[role="dialog"][aria-label="图片查看"]')).toBeNull();
  await act(async () => (thumb!.parentElement as HTMLButtonElement).click());
  dialog = document.body.querySelector('[role="dialog"][aria-label="图片查看"]');
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(document.body.querySelector('[role="dialog"][aria-label="图片查看"]')).toBeNull();
});

it('Pi 扩展的可见消息单独成卡，标出 customType', async () => {
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...chat,
          messages: [
            ...chat.messages,
            {
              role: 'assistant',
              content: 'deployed **ok**',
              parts: [],
              extension: { customType: 'deploy' },
            },
          ],
        }}
      />,
    ),
  );
  expect(host.textContent).toContain('扩展 · deploy');
  expect(host.textContent).toContain('deployed **ok**');
});
