// @vitest-environment jsdom
// 「新建对话」的落位：已在通用池工作台（资料页）里发起时就地开标签，用户不该被甩回首页；
// 落位与资料页标题栏「新聊天」一致——单组向右分屏，多组进最右组。首页发起时仍回首页聊天。
// 通用会话的工作目录归属跟着发起页走：资料页的落在课程目录，首页的落在随聊私有目录。
import { beforeEach, expect, it } from 'vitest';
import type { ChatScope, DelaApi, WorkspaceChat } from '../../shared/api';
import { useSessions } from '../sessions/store';
import { createDefaultLayout, walkGroups } from '../workbench/layout-schema';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { useNavigationStore } from './view';

function emptyChat(sessionId: string): WorkspaceChat {
  return {
    sessionId,
    projectId: null,
    cwd: null,
    configured: true,
    providerName: null,
    model: 'test',
    models: [],
    effortLevels: [],
    effort: null,
    messages: [],
  };
}

const groups = () => walkGroups(useWorkbenchLayout.getState().root);
/** 每次 session.create 的实参（通用会话的工作目录归属由它决定）。 */
const creates: Array<[string | null, ChatScope]> = [];

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
  window.dela = {
    layout: { get: async () => null, save: async () => {} },
    session: {
      create: async (projectId: string | null, scope: ChatScope) => {
        creates.push([projectId, scope]);
        return emptyChat('new');
      },
      list: async () => [],
      open: async (id: string) => useSessions.getState().chats[id]!,
    },
  } as unknown as DelaApi;
});

it('通用池工作台里新建对话就地开标签，不跳首页', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });

  await useNavigationStore.getState().newChat(null);

  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(useNavigationStore.getState().reveal?.tabId).toBe('chat:new');
  expect(useNavigationStore.getState().generalChat).toBeNull();
});

it('工作台只有一组时新建对话向右分屏', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });
  useWorkbenchLayout.getState().openTab('note:a');

  await useNavigationStore.getState().newChat(null);

  expect(groups()).toHaveLength(2);
  expect(useWorkbenchLayout.getState().focus).toBe(groups()[1]!.id);
});

it('工作台已有多组时新建对话进最右组，不再分屏', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });
  useWorkbenchLayout.getState().openTab('note:a');
  useWorkbenchLayout.getState().splitGroup('primary', 'vertical');
  const rightmost = groups()[1]!.id;
  useWorkbenchLayout.getState().focusGroup('primary');

  await useNavigationStore.getState().newChat(null);

  expect(groups()).toHaveLength(2);
  expect(useWorkbenchLayout.getState().focus).toBe(rightmost);
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

it('通用会话的归属跟着发起页走：资料页 library，首页 chat', async () => {
  useNavigationStore.setState({ view: 'workbench', projectId: null });
  await useNavigationStore.getState().newChat(null);
  useNavigationStore.setState({ view: 'home' });
  await useNavigationStore.getState().newChat(null);

  expect(creates).toEqual([
    [null, 'library'],
    [null, 'chat'],
  ]);
});
