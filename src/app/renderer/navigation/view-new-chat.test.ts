// @vitest-environment jsdom
// 「新建对话」与「打开会话」的落位：工作台里（项目或资料）就地在焦点组开标签，不跳页、不分屏；
// 只有首页发起的随聊留在首页。通用会话的工作目录归属跟着发起页走（资料页 library、首页 chat）。
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatScope, WorkspaceChat } from '../../../core/protocol/agent';

// 契约客户端在模块加载时取 bridge，须先于导入装好。
const creates = vi.hoisted(() => {
  /** 每次 create-session 的入参（通用会话的工作目录归属由它决定）。 */
  const creates: Array<{ projectId: string | null; scope: ChatScope }> = [];
  const handlers: Record<string, (input: never) => unknown> = {
    'agent:create-session': (input: { projectId: string | null; scope: ChatScope }) => {
      creates.push(input);
      return emptyChat('new');
    },
    'agent:list-sessions': () => [],
    'agent:open-session': ({ sessionId }: { sessionId: string }) =>
      useSessions.getState().chats[sessionId]!,
  };
  window.dela = {
    bridge: {
      invoke: async (channel: string, input: never) => handlers[channel]!(input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  return creates;
});
import { useSessions } from '../../../modules/chat/view';
import { createDefaultLayout, walkGroups } from '../workbench/layout-schema';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { useNavigationStore } from './view';

function emptyChat(sessionId: string): WorkspaceChat {
  return {
    sessionId,
    projectId: null,
    cwd: null,
    configured: true,
    providerId: null,
    providerName: null,
    model: 'test',
    modelUnavailable: false,
    effortLevels: [],
    effort: null,
    messages: [],
  };
}

const groups = () => walkGroups(useWorkbenchLayout.getState().root);

beforeEach(() => {
  creates.length = 0;
  useNavigationStore.setState({
    view: 'home',
    projectId: null,
    reveal: null,
    generalChat: null,
    backStack: [],
    forwardStack: [],
  });
  useSessions.setState({ chats: {}, lists: {} });
  useWorkbenchLayout.setState({ ...createDefaultLayout(), projectId: null, ready: true });
});

it('资料工作台里新建对话就地开标签，不跳首页、不分屏', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });
  useWorkbenchLayout.getState().openTab('note:a');

  await useNavigationStore.getState().newChat(null);

  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(useNavigationStore.getState().reveal?.tabId).toBe('chat:new');
  expect(useNavigationStore.getState().generalChat).toBeNull();
  expect(groups()).toHaveLength(1);
});

it('项目工作台里新建对话同样就地开标签', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: 'p1' });
  useWorkbenchLayout.setState({ projectId: 'p1' });

  await useNavigationStore.getState().newChat('p1');

  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(useNavigationStore.getState().projectId).toBe('p1');
  expect(useNavigationStore.getState().reveal?.tabId).toBe('chat:new');
});

it('新建对话不再顺手关掉别的空会话标签', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });
  useSessions.setState({ chats: { old: emptyChat('old') }, lists: {} });
  useWorkbenchLayout.getState().openTab('chat:old');

  await useNavigationStore.getState().newChat(null);

  expect(groups()[0]!.tabs).toContain('chat:old');
});

it('首页新建对话仍落在首页聊天', async () => {
  await useNavigationStore.getState().newChat(null);

  expect(useNavigationStore.getState().view).toBe('home');
  expect(useNavigationStore.getState().generalChat).toMatchObject({
    create: false,
    sessionId: 'new',
  });
  expect(useNavigationStore.getState().reveal).toBeNull();
});

it('资料工作台里打开随聊历史：留在工作台开标签，不跳回首页', () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });

  useNavigationStore.getState().openChat('old', null);

  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(useNavigationStore.getState().reveal?.tabId).toBe('chat:old');
  expect(useNavigationStore.getState().generalChat).toBeNull();
});

it('在首页或项目工作台打开随聊：回首页聊天', () => {
  useNavigationStore.setState({ view: 'workbench', projectId: 'p1' });

  useNavigationStore.getState().openChat('old', null);

  expect(useNavigationStore.getState().view).toBe('home');
  expect(useNavigationStore.getState().generalChat?.sessionId).toBe('old');
});

it('通用会话的归属跟着发起页走：资料页 library，首页 chat', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });
  await useNavigationStore.getState().newChat(null);
  useNavigationStore.setState({ view: 'home' });
  await useNavigationStore.getState().newChat(null);

  expect(creates).toEqual([
    { projectId: null, scope: 'library' },
    { projectId: null, scope: 'chat' },
  ]);
});
