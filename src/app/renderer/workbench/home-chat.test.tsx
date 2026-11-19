// @vitest-environment jsdom
import { act } from 'react';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceChat } from '../../../core/protocol/agent';

// 契约客户端在模块加载时取 bridge，须先于导入装好；各用例按通道替换或监视 handler。
const { api, dela } = vi.hoisted(() => {
  const api: Record<string, (input: never) => unknown> = {};
  const dela = {
    bridge: {
      invoke: async (channel: string, input: never) => api[channel]!(input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  window.dela = dela;
  return { api, dela };
});
import { useNavigationStore } from '../navigation/view';
import { useWorkbenchLayout } from './layout-store';
import { walkGroups } from './layout-schema';
import { toasts } from '../../../ui/toast';
import {
  ChatHome,
  ChatTabSourceProvider,
  useChatDrafts,
  useSessions,
} from '../../../modules/chat/view';

// 保留 ChatHome、ChatTab、发送逻辑与导航 store；输入编辑器和消息排版不参与路由验证。
vi.mock('../../../modules/chat/view/ChatComposer', () => ({
  ChatComposer: ({
    value,
    onChange,
    onSend,
    notice,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    notice?: string | null;
  }) => (
    <>
      <input
        aria-label="消息输入"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button onClick={onSend}>发送</button>
      {notice && <p role="alert">{notice}</p>}
    </>
  ),
}));
vi.mock('../../../modules/chat/view/ChatThread', () => ({
  ChatThread: ({ chat }: { chat: WorkspaceChat }) => (
    <div aria-label="对话消息">{chat.messages.map((message) => message.content).join('\n')}</div>
  ),
}));

// 查询结果默认经 setTimeout 通知，act 等不到：改走微任务。
notifyManager.setScheduler(queueMicrotask);

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const noChatTab = () =>
  !walkGroups(useWorkbenchLayout.getState().root).some((group) =>
    group.tabs.some((tab) => tab.startsWith('chat:')),
  );

/** 代替工作台装配层：把导航的首页请求交给首页，跳转接到真实导航 store。 */
function Home() {
  const request = useNavigationStore((state) => state.generalChat);
  const source = {
    navigate: useNavigationStore.getState().navigate,
    workbench: { open: () => {}, openDocument: () => {}, close: () => {} },
    opensLink: () => false,
  };
  return (
    <QueryClientProvider client={queryClient}>
      <ChatTabSourceProvider source={source}>
        <ChatHome request={request} />
      </ChatTabSourceProvider>
    </QueryClientProvider>
  );
}

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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useNavigationStore.setState({
    view: 'home',
    projectId: null,
    generalChat: null,
    backStack: [],
    forwardStack: [],
  });
  useWorkbenchLayout.setState({ pendingReveal: null });
  useSessions.setState({ chats: {}, lists: {}, homeSessionId: null });
  useChatDrafts.setState({ drafts: {} });
  for (const channel of Object.keys(api)) delete api[channel];
  Object.assign(api, {
    'agent:create-session': async () => emptyChat('first'),
    'agent:list-sessions': async () => [],
    'agent:open-session': async ({ sessionId }: { sessionId: string }) =>
      useSessions.getState().chats[sessionId]!,
    'agent:ask': async ({ sessionId, text }: { sessionId: string; text: string }) => ({
      ...emptyChat(sessionId),
      messages: [
        { role: 'user' as const, content: text },
        { role: 'assistant' as const, content: '回答' },
      ],
    }),
  });
  window.dela = dela;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  delete window.dela;
  vi.unstubAllGlobals();
});

it('随聊发送首条消息后保持首页聊天，继续显示同一会话的回复', async () => {
  await act(async () => root.render(<Home />));
  await act(async () => useChatDrafts.getState().update('first', { prompt: '测试随聊' }));
  await act(async () =>
    host.querySelectorAll('button').forEach((button) => {
      if (button.textContent === '发送') button.click();
    }),
  );
  expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toBe('测试随聊\n回答');
  expect(useNavigationStore.getState().view).toBe('home');
  expect(useWorkbenchLayout.getState().pendingReveal).toBeNull();
  expect(noChatTab()).toBe(true);
});

it('回到首页接着上次会话，清空运行内存（重启）后才是新对话', async () => {
  await act(async () => root.render(<Home />));
  await act(async () =>
    useSessions.getState().putChat('first', {
      ...emptyChat('first'),
      messages: [{ role: 'assistant' as const, content: '上次的回复' }],
    }),
  );
  const create = vi.spyOn(api, 'agent:create-session');
  // 切走再回首页（侧栏「首页」就是 openGeneralChat(false)）：接着上次的会话，不新建。
  await act(async () => useNavigationStore.getState().openGeneralChat(false));
  expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toBe('上次的回复');
  expect(create).not.toHaveBeenCalled();
  // 重启等于这块内存没了：首页回到新对话。
  await act(async () => useSessions.setState({ homeSessionId: null }));
  await act(async () => useNavigationStore.getState().openGeneralChat(false));
  expect(create).toHaveBeenCalledTimes(1);
  // 首页发起的通用会话落在随聊私有目录，不认资料页那一档。
  expect(create).toHaveBeenCalledWith({ projectId: null });
});

it('历史快速切换时延迟返回不能覆盖最新会话，项目历史仍进入项目工作台', async () => {
  await act(async () => root.render(<Home />));
  let resolveOld!: (chat: WorkspaceChat) => void;
  const latest = {
    ...emptyChat('latest'),
    messages: [{ role: 'assistant' as const, content: '最新选中的历史' }],
  };
  useSessions.getState().putChat('latest', latest);
  api['agent:open-session'] = ({ sessionId }: { sessionId: string }) =>
    sessionId === 'slow'
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
  expect(useWorkbenchLayout.getState().pendingReveal?.tabId).toBe('chat:project-history');
});

describe('会话命令', () => {
  const sendText = async (text: string) => {
    await act(async () => useChatDrafts.getState().update('first', { prompt: text }));
    await act(async () =>
      host.querySelectorAll('button').forEach((button) => {
        if (button.textContent === '发送') button.click();
      }),
    );
  };

  it('/name 走命令通道、不发给模型，改完重读会话列表让标题生效', async () => {
    const runCommand = vi.fn(async ({ sessionId }: { sessionId: string }) => emptyChat(sessionId));
    api['agent:run-command'] = runCommand;
    const ask = vi.spyOn(api, 'agent:ask');
    await act(async () => root.render(<Home />));
    const list = vi.spyOn(api, 'agent:list-sessions');
    await sendText('  /name  课程周报  ');
    expect(runCommand).toHaveBeenCalledWith({
      sessionId: 'first',
      name: 'name',
      args: '课程周报',
    });
    expect(ask).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ projectId: null });
    expect(useChatDrafts.getState().drafts.first?.prompt ?? '').toBe('');
    expect(toasts().at(-1)?.title).toBe('已重命名');
  });

  it('命令失败时提示原因并把输入放回去', async () => {
    api['agent:run-command'] = vi.fn(async () => {
      throw new Error('对话还太短，没有可压缩的内容');
    });
    await act(async () => root.render(<Home />));
    await sendText('/compact 保留结论');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('对话还太短，没有可压缩的内容');
    expect(useChatDrafts.getState().drafts.first?.prompt).toBe('/compact 保留结论');
  });

  it('只是以 / 开头、不是命令的文字照常发给模型', async () => {
    const runCommand = vi.fn();
    api['agent:run-command'] = runCommand;
    const ask = vi.spyOn(api, 'agent:ask');
    await act(async () => root.render(<Home />));
    await sendText('/compactor 是什么');
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'first', text: '/compactor 是什么' }),
    );
    expect(runCommand).not.toHaveBeenCalled();
  });
});
