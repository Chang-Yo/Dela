// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspaceChat } from '../../../shared/api';
import { useNavigationStore } from '../../navigation/view';
import { useSessions } from '../../sessions/store';
import { useChatDrafts } from './drafts';
import { useToastStore } from '../../app/toasts';
import { ChatHome } from './ChatHome';
import type { ChatComposer } from './ChatComposer';

// 保留 ChatHome、ChatTab、发送逻辑与导航 store；输入编辑器和消息排版不参与路由验证。
vi.mock('./ChatComposer', () => ({
  ChatComposer: ({ value, onChange, onSend, notice }: ComponentProps<typeof ChatComposer>) => (
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
    lastHomeSessionId: null,
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
  vi.useRealTimers();
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
  await act(async () => resolveNew(emptyChat('second')));
  await act(async () => useChatDrafts.getState().update('second', { prompt: '新会话草稿' }));
  expect(host.querySelector<HTMLInputElement>('[aria-label="消息输入"]')?.value).toBe('新会话草稿');
  expect(useNavigationStore.getState().view).toBe('home');
});

it('回到首页接着上次会话，清空运行内存（重启）后才是新对话', async () => {
  await act(async () => root.render(<ChatHome />));
  await act(async () =>
    useSessions.getState().putChat('first', {
      ...emptyChat('first'),
      messages: [{ role: 'assistant' as const, content: '上次的回复' }],
    }),
  );
  const create = vi.spyOn(window.dela!.session, 'create');
  // 切走再回首页（侧栏「首页」就是 openGeneralChat(false)）：接着上次的会话，不新建。
  await act(async () => useNavigationStore.getState().openGeneralChat(false));
  expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toBe('上次的回复');
  expect(create).not.toHaveBeenCalled();
  // 重启等于这块内存没了：首页回到新对话。
  await act(async () => useNavigationStore.setState({ lastHomeSessionId: null }));
  await act(async () => useNavigationStore.getState().openGeneralChat(false));
  expect(create).toHaveBeenCalledTimes(1);
  // 首页发起的通用会话落在随聊私有目录，不认资料页那一档。
  expect(create).toHaveBeenCalledWith(null, 'chat');
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
    const runCommand = vi.fn(async (id: string) => emptyChat(id));
    window.dela!.session.runCommand = runCommand;
    const ask = vi.spyOn(window.dela!.session, 'ask');
    await act(async () => root.render(<ChatHome />));
    const list = vi.spyOn(window.dela!.session, 'list');
    await sendText('  /name  课程周报  ');
    expect(runCommand).toHaveBeenCalledWith('first', 'name', '课程周报');
    expect(ask).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith(null, '');
    expect(useChatDrafts.getState().drafts.first?.prompt ?? '').toBe('');
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('已重命名');
  });

  it('命令失败时提示原因并把输入放回去', async () => {
    window.dela!.session.runCommand = vi.fn(async () => {
      throw new Error('对话还太短，没有可压缩的内容');
    });
    await act(async () => root.render(<ChatHome />));
    await sendText('/compact 保留结论');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('对话还太短，没有可压缩的内容');
    expect(useChatDrafts.getState().drafts.first?.prompt).toBe('/compact 保留结论');
  });

  it('/new 开新对话，不发消息也不走命令通道', async () => {
    const runCommand = vi.fn();
    window.dela!.session.runCommand = runCommand;
    const ask = vi.spyOn(window.dela!.session, 'ask');
    await act(async () => root.render(<ChatHome />));
    const create = vi.spyOn(window.dela!.session, 'create').mockResolvedValue(emptyChat('second'));
    await sendText('/new');
    expect(create).toHaveBeenCalledWith(null, 'chat');
    expect(ask).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('只是以 / 开头、不是命令的文字照常发给模型', async () => {
    const runCommand = vi.fn();
    window.dela!.session.runCommand = runCommand;
    const ask = vi.spyOn(window.dela!.session, 'ask');
    await act(async () => root.render(<ChatHome />));
    await sendText('/compactor 是什么');
    expect(ask).toHaveBeenCalledWith(
      'first',
      expect.objectContaining({ text: '/compactor 是什么' }),
    );
    expect(runCommand).not.toHaveBeenCalled();
  });
});

it('归档首页当前对话后通过导航创建新会话，不沿用归档会话身份', async () => {
  vi.useFakeTimers();
  await act(async () => root.render(<ChatHome />));
  window.dela!.session.list = vi.fn(async () => [
    {
      id: 'first',
      projectId: null,
      title: '当前对话',
      messageCount: 1,
      archived: false,
      pinned: false,
      updatedAt: new Date().toISOString(),
    },
  ]);
  window.dela!.session.update = vi.fn(async () => {});
  const create = vi.spyOn(window.dela!.session, 'create').mockResolvedValue(emptyChat('second'));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="历史对话"]')!.click());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="归档对话 当前对话"]')!.click(),
  );
  await act(async () => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === '确认归档')!
      .click();
  });
  expect(window.dela!.session.update).toHaveBeenCalledWith('first', { archived: true });
  expect(create).toHaveBeenCalledWith(null, 'chat');
  expect(useNavigationStore.getState().lastHomeSessionId).toBe('second');
  await act(async () => useChatDrafts.getState().update('second', { prompt: '归档之后的新草稿' }));
  expect(host.querySelector<HTMLInputElement>('[aria-label="消息输入"]')?.value).toBe(
    '归档之后的新草稿',
  );
});
