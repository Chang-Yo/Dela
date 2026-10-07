// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspaceChat } from '../../../shared/api';
import { useNavigationStore } from '../../app/navigation';
import { useSessions } from '../../sessions/store';
import { useChatDrafts } from './drafts';
import { ChatHome } from './ChatHome';
import type { ChatComposer } from './ChatComposer';

// 保留 ChatHome、ChatTab、发送逻辑与导航 store；输入编辑器和消息排版不参与路由验证。
vi.mock('./ChatComposer', () => ({
  ChatComposer: ({ value, onChange, onSend }: ComponentProps<typeof ChatComposer>) => (
    <>
      <input
        aria-label="消息输入"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button onClick={onSend}>发送</button>
    </>
  ),
}));
vi.mock('./ChatThread', () => ({
  ChatThread: ({ chat }: { chat: WorkspaceChat }) => (
    <div aria-label="对话消息">{chat.messages.map((message) => message.content).join('\n')}</div>
  ),
}));

let host: HTMLDivElement;
let root: Root;

function emptyChat(sessionId: string): WorkspaceChat {
  return {
    sessionId,
    configured: true,
    providerName: null,
    model: 'test',
    models: [],
    effortLevels: [],
    effort: null,
    messages: [],
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useNavigationStore.setState({
    view: 'home',
    projectId: null,
    generalChat: null,
    reveal: null,
    backStack: [],
    forwardStack: [],
  });
  useSessions.setState({ chats: {}, lists: {} });
  useChatDrafts.setState({ drafts: {} });
  window.dela = {
    session: {
      create: async () => emptyChat('first'),
      list: async () => [],
      open: async (id: string) => useSessions.getState().chats[id]!,
      ask: async (id: string, input: { text: string }) => ({
        ...emptyChat(id),
        messages: [
          { role: 'user' as const, content: input.text },
          { role: 'assistant' as const, content: '回答' },
        ],
      }),
    },
  } as unknown as DelaApi;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

it('随聊发送首条消息后保持首页聊天，继续显示同一会话的回复', async () => {
  await act(async () => root.render(<ChatHome />));
  await act(async () => useChatDrafts.getState().update('first', { prompt: '测试随聊' }));
  await act(async () =>
    host.querySelectorAll('button').forEach((button) => {
      if (button.textContent === '发送') button.click();
    }),
  );
  expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toBe('测试随聊\n回答');
  expect(useNavigationStore.getState().view).toBe('home');
  expect(useNavigationStore.getState().reveal).toBeNull();
});

it('新对话创建期间不显示旧会话，返回后绑定新身份', async () => {
  await act(async () => root.render(<ChatHome />));
  await act(async () =>
    useSessions.getState().putChat('first', {
      ...emptyChat('first'),
      messages: [{ role: 'user', content: '上一轮消息' }],
    }),
  );
  let resolveNew!: (chat: WorkspaceChat) => void;
  window.dela!.session.create = () =>
    new Promise((resolve) => {
      resolveNew = resolve;
    });
  await act(async () => useNavigationStore.getState().openGeneralChat(true));
  expect(host.querySelector('[aria-label="消息输入"]')).toBeNull();
  expect(host.textContent).not.toContain('上一轮消息');
  expect(host.textContent).toContain('正在打开对话');
  await act(async () => resolveNew(emptyChat('second')));
  await act(async () => useChatDrafts.getState().update('second', { prompt: '新会话草稿' }));
  expect(host.querySelector<HTMLInputElement>('[aria-label="消息输入"]')?.value).toBe('新会话草稿');
  expect(useNavigationStore.getState().view).toBe('home');
});

it('打开随聊历史留在首页，展示指定会话而不是创建空会话或资料标签', async () => {
  const history = {
    ...emptyChat('history'),
    messages: [{ role: 'assistant' as const, content: '历史回复' }],
  };
  useSessions.getState().putChat('history', history);
  const create = vi.spyOn(window.dela!.session, 'create');
  await act(async () => useNavigationStore.getState().openChat('history', null));
  await act(async () => root.render(<ChatHome />));
  expect(useNavigationStore.getState().view).toBe('home');
  expect(useNavigationStore.getState().reveal).toBeNull();
  expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toBe('历史回复');
  expect(create).not.toHaveBeenCalled();
});

it('历史快速切换时延迟返回不能覆盖最新会话，项目历史仍进入项目工作台', async () => {
  await act(async () => root.render(<ChatHome />));
  let resolveOld!: (chat: WorkspaceChat) => void;
  const latest = {
    ...emptyChat('latest'),
    messages: [{ role: 'assistant' as const, content: '最新选中的历史' }],
  };
  useSessions.getState().putChat('latest', latest);
  window.dela!.session.open = (id) =>
    id === 'slow'
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(latest);
  await act(async () => useNavigationStore.getState().openChat('slow', null));
  expect(host.querySelector('[aria-label="消息输入"]')).toBeNull();
  await act(async () => useNavigationStore.getState().openChat('latest', null));
  await act(async () =>
    resolveOld({
      ...emptyChat('slow'),
      messages: [{ role: 'assistant', content: '较早选中的历史' }],
    }),
  );
  expect(host.textContent).toContain('最新选中的历史');
  expect(host.textContent).not.toContain('较早选中的历史');
  expect(useNavigationStore.getState().view).toBe('home');
  await act(async () => useNavigationStore.getState().openChat('project-history', 'project'));
  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(useNavigationStore.getState().projectId).toBe('project');
  expect(useNavigationStore.getState().reveal?.tabId).toBe('chat:project-history');
});
