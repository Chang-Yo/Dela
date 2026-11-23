// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceChat } from '../../../core/protocol/agent';

// 契约客户端在模块加载时取 bridge，须先于导入装好。
const creates = vi.hoisted(() => {
  const creates: Array<{ projectId: string | null }> = [];
  const handlers: Record<string, (input: never) => unknown> = {
    'agent:create-session': (input: { projectId: string | null }) => {
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
const isActiveTab = (tabId: string) => groups().some((group) => group.active === tabId);

beforeEach(() => {
  creates.length = 0;
  useNavigationStore.setState({
    view: 'home',
    projectId: null,
    generalChat: null,
    backStack: [],
    forwardStack: [],
  });
  useSessions.setState({ chats: {}, lists: {} });
  useWorkbenchLayout.setState({
    ...createDefaultLayout(),
    projectId: null,
    ready: true,
    pendingReveal: null,
  });
});

it('资料工作台里新建对话就地开标签，不跳首页、不分屏', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });
  useWorkbenchLayout.getState().openTab('note:a');

  await useNavigationStore.getState().newChat(null);

  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(isActiveTab('chat:new')).toBe(true);
  expect(useNavigationStore.getState().generalChat).toBeNull();
  expect(groups()).toHaveLength(1);
});

it('项目工作台里新建对话同样就地开标签', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: 'p1' });
  useWorkbenchLayout.setState({ projectId: 'p1' });

  await useNavigationStore.getState().newChat('p1');

  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(useNavigationStore.getState().projectId).toBe('p1');
  expect(isActiveTab('chat:new')).toBe(true);
});

it('首页新建对话仍落在首页聊天', async () => {
  await useNavigationStore.getState().newChat(null);

  expect(useNavigationStore.getState().view).toBe('home');
  expect(useNavigationStore.getState().generalChat).toMatchObject({
    create: false,
    sessionId: 'new',
  });
  expect(useWorkbenchLayout.getState().pendingReveal).toBeNull();
  expect(groups().some((group) => group.tabs.some((tab) => tab.startsWith('chat:')))).toBe(false);
});

it('资料工作台里打开随聊历史：留在工作台开标签，不跳回首页', () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });

  useNavigationStore.getState().openChat('old', null);

  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(isActiveTab('chat:old')).toBe(true);
  expect(useNavigationStore.getState().generalChat).toBeNull();
});

it('在首页或项目工作台打开随聊：回首页聊天', () => {
  useNavigationStore.setState({ view: 'workbench', projectId: 'p1' });

  useNavigationStore.getState().openChat('old', null);

  expect(useNavigationStore.getState().view).toBe('home');
  expect(useNavigationStore.getState().generalChat?.sessionId).toBe('old');
});
