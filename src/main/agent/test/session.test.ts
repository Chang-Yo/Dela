// 会话层：Pi 消息 → WorkspaceChat 投影；会话 cwd 取库里的 cwd 列（随聊是私有目录，资料页是课程目录），
// cwd 为 NULL 的旧会话按项目目录/工作区根解析，项目目录缺失时报错而不换目录。
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  root: '',
  configured: false,
  messages: [] as AgentMessage[],
  prompts: [] as string[],
  onPrompt: null as (() => void | Promise<void>) | null,
}));
vi.mock('electron', () => ({ app: { getPath: () => state.root }, shell: {} }));
vi.mock('../../database', () => ({ getDatabase: () => state.db }));
vi.mock('../providers', () => ({
  getActiveLlmProvider: () =>
    state.configured ? { name: 'test', model: 'm', models: [], effortLevels: [] } : null,
}));
vi.mock('../../documents/runtime', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: () => {},
}));
vi.mock('../pi', () => ({
  openPiSession: async () => ({
    subscribe: () => () => {},
    get messages() {
      return state.messages;
    },
    getSessionStats: () => ({ contextUsage: null }),
    dispose: () => {},
    abort: async () => {},
    prompt: async (text: string) => {
      state.prompts.push(text);
      state.messages.push({ role: 'user', content: text, timestamp: Date.now() });
      await state.onPrompt?.();
    },
  }),
}));
vi.mock('../environment', () => ({
  agentEnvironment: () => ({
    sessionOptions: async () => ({}),
    workspaceRoot: () => {
      const root = join(state.root, 'Dela', 'workspace');
      mkdirSync(root, { recursive: true });
      return root;
    },
  }),
}));
vi.mock('../../settings/task-notify', () => ({ notifyRunFinished: () => {} }));
vi.mock('../extensions', () => ({
  bindSessionExtensions: async () => {},
  extensionCommand: (_session: unknown, text: string) => text.startsWith('/ext-'),
  releaseExtensionUi: () => {},
  sessionSlashCommands: () => [],
}));
vi.mock('../packages', () => ({ packagesEnabled: () => false }));
import {
  askSession,
  invalidateSessions,
  newSession,
  openSession,
  projectMessages,
  listSessionTurnChanges,
  readSessionTurnFileChange,
  readSessionUncommittedChanges,
  cancelRun,
  deleteSession,
} from '../session';
import { readChatAttachment, stageChatMedia } from '../media';
import * as changes from '../changes';

beforeEach(() => {
  state.configured = false;
  state.messages = [];
  state.prompts = [];
  state.onPrompt = null;
  state.root = mkdtempSync(join(tmpdir(), 'dela-session-'));
  state.db = new Database(':memory:');
  state.db.pragma('foreign_keys = ON');
  state.db.exec(`
    CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
      kind TEXT NOT NULL, source_id TEXT, local_path TEXT, remote_id TEXT,
      updated_at TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES workspace_entries(id) ON DELETE SET NULL, file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话', message_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      cwd TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
});

afterEach(() => {
  vi.restoreAllMocks();
  invalidateSessions();
  state.db?.close();
  rmSync(state.root, { recursive: true, force: true });
});

it('真实 ask 生命周期冻结文件变化并将 turnId 持久化到消息元数据', async () => {
  state.configured = true;
  const chat = newSession(null, 'chat');
  const path = join(chat.cwd!, 'output.txt');
  writeFileSync(path, 'before');
  state.onPrompt = () => {
    writeFileSync(path, 'after');
  };
  const response = await askSession(chat.sessionId!, {
    text: '生成文件',
    attachments: [],
    context: [],
  });
  const turns = await listSessionTurnChanges(chat.sessionId!);
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({
    state: 'complete',
    runStatus: 'completed',
    files: [{ path: 'output.txt', status: 'modified' }],
  });
  expect(response.messages[0]?.turnId).toBe(turns[0]!.turnId);
  expect(
    await readSessionTurnFileChange(chat.sessionId!, turns[0]!.turnId, 'output.txt'),
  ).toMatchObject({ before: 'before', after: 'after' });
  expect(await readSessionUncommittedChanges(chat.sessionId!)).toMatchObject({
    available: false,
    reason: 'not-git',
  });
});

it('prompt 失败仍冻结此前的文件修改，不吞掉原始错误', async () => {
  state.configured = true;
  const chat = newSession(null, 'chat');
  state.onPrompt = () => {
    writeFileSync(join(chat.cwd!, 'partial.txt'), 'partial');
    throw new Error('model failed');
  };
  await expect(
    askSession(chat.sessionId!, { text: '尝试', attachments: [], context: [] }),
  ).rejects.toThrow('model failed');
  expect(await listSessionTurnChanges(chat.sessionId!)).toMatchObject([
    { runStatus: 'failed', files: [{ path: 'partial.txt', status: 'added' }] },
  ]);
});

it('用户停止仍冻结已产生的文件，并在删除会话时清理快照', async () => {
  state.configured = true;
  const chat = newSession(null, 'chat');
  state.onPrompt = () => {
    writeFileSync(join(chat.cwd!, 'stopped.txt'), 'partial');
    cancelRun(chat.sessionId!);
  };
  await askSession(chat.sessionId!, { text: '停止', attachments: [], context: [] });
  const [turn] = await listSessionTurnChanges(chat.sessionId!);
  expect(turn).toMatchObject({
    runStatus: 'stopped',
    files: [{ path: 'stopped.txt', status: 'added' }],
  });
  await deleteSession(chat.sessionId!);
  expect(existsSync(join(state.root, 'chat-changes', chat.sessionId!))).toBe(false);
});

it('远程会话不读取同名本地目录，接口明确返回不可用', async () => {
  state.configured = true;
  state
    .db!.prepare(
      "INSERT INTO workspace_entries VALUES ('remote-project', NULL, '远程', 'project', NULL, '/remote/project', 'remote-id', 'x')",
    )
    .run();
  const chat = newSession('remote-project', 'chat');
  await askSession(chat.sessionId!, { text: '读取远程', attachments: [], context: [] });
  expect(await readSessionUncommittedChanges(chat.sessionId!)).toMatchObject({
    available: false,
    reason: 'remote',
  });
  expect(await listSessionTurnChanges(chat.sessionId!)).toMatchObject([
    { state: 'unavailable', files: [] },
  ]);
});

it('快照失败不阻止模型运行，结果明确标记 unavailable', async () => {
  state.configured = true;
  const chat = newSession(null, 'chat');
  vi.spyOn(changes, 'captureDirectory').mockRejectedValueOnce(new Error('scan failed'));
  await askSession(chat.sessionId!, { text: '继续回答', attachments: [], context: [] });
  expect(state.prompts).toHaveLength(1);
  expect(await listSessionTurnChanges(chat.sessionId!)).toMatchObject([
    { state: 'unavailable', warnings: ['scan failed'] },
  ]);
});

it('sends document-only messages as file references instead of decoding binary bytes into the prompt', async () => {
  state.configured = true;
  const bytes = Buffer.from([80, 75, 3, 4, 255, 0]);
  const document = stageChatMedia('汇报.pptx.pptx', bytes);
  const attachment = readChatAttachment(document.id);
  if (!('path' in attachment)) throw new Error('expected document file');
  const chat = newSession(null, 'chat');
  const response = await askSession(chat.sessionId!, {
    text: '',
    attachments: [document.id],
    context: [],
  });
  expect(state.prompts[0]).toContain('document-reading skill');
  expect(state.prompts[0]).toContain(JSON.stringify(attachment.path));
  expect(state.prompts[0]).not.toContain(bytes.toString('utf8'));
  expect(response.messages[0]).toMatchObject({
    role: 'user',
    attachments: [{ name: document.name, id: document.id }],
  });
  expect(readFileSync(attachment.path).equals(bytes)).toBe(true);
  expect(() => readChatAttachment(document.id)).toThrow('不存在');
});

it('continues to inline ordinary text attachment contents', async () => {
  state.configured = true;
  const attachment = stageChatMedia('notes.txt', Buffer.from('普通文本附件'));
  const chat = newSession(null, 'chat');
  await askSession(chat.sessionId!, { text: '总结', attachments: [attachment.id], context: [] });
  expect(state.prompts[0]).toContain('<attachment name="notes.txt">\n普通文本附件\n</attachment>');
});

const assistant = (content: unknown[], extra: object = {}) =>
  ({
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'dela',
    model: 'm',
    usage: {},
    stopReason: 'toolUse',
    timestamp: 20,
    ...extra,
  }) as unknown as AgentMessage;

describe('projectMessages', () => {
  it('一轮内的思考、工具与正文合成一条回复，工具结果按 id 回填', () => {
    const messages = [
      { role: 'user', content: '改一下 a.txt', timestamp: 10 },
      assistant([
        { type: 'thinking', thinking: '先读文件' },
        { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a.txt' } },
      ]),
      {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'read',
        content: [{ type: 'text', text: 'alpha' }],
        isError: false,
        timestamp: 30,
      },
      assistant([{ type: 'text', text: '改好了' }], { stopReason: 'stop', timestamp: 40 }),
    ] as AgentMessage[];
    const [user, reply] = projectMessages(messages);
    expect(user).toMatchObject({ role: 'user', content: '改一下 a.txt' });
    expect(reply).toMatchObject({ role: 'assistant', content: '改好了', startedAt: 10 });
    expect(reply!.parts!.map((part) => part.type)).toEqual(['reasoning', 'tools', 'text']);
    expect(reply!.toolResults![0]).toMatchObject({
      name: 'read',
      input: { path: 'a.txt' },
      output: { text: 'alpha' },
      finishedAt: 30,
    });
  });

  it('工具结果里的图片本体透传到 output.image，供轨迹预览', () => {
    const messages = [
      { role: 'user', content: '读一下 05.jpg', timestamp: 10 },
      assistant([{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: '05.jpg' } }]),
      {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'read',
        content: [
          { type: 'text', text: 'Read image file [image/jpeg]' },
          { type: 'image', mimeType: 'image/jpeg', data: 'aGVsbG8=' },
        ],
        isError: false,
        timestamp: 30,
      },
    ] as AgentMessage[];
    const [, reply] = projectMessages(messages);
    expect(reply!.toolResults![0]!.output).toEqual({
      text: 'Read image file [image/jpeg]',
      image: { mimeType: 'image/jpeg', data: 'aGVsbG8=' },
    });
  });

  it('用户消息的 Dela 元数据前缀不进展示，引用与图片还原到消息字段', () => {
    const meta = { body: '看看这个', sources: [{ key: 'D:/p/a.md', title: 'D:/p/a.md' }] };
    const [user] = projectMessages([
      {
        role: 'user',
        content: `<dela-meta>${JSON.stringify(meta)}</dela-meta>\n用户引用了这些文件……看看这个`,
        timestamp: 1,
      },
    ] as AgentMessage[]);
    expect(user).toMatchObject({ content: '看看这个', sources: meta.sources });
  });

  it('模型报错的回复标记中断并给出原因', () => {
    const [, reply] = projectMessages([
      { role: 'user', content: 'hi', timestamp: 1 },
      assistant([], { stopReason: 'error', errorMessage: '401: unauthorized' }),
    ] as AgentMessage[]);
    expect(reply).toMatchObject({ interrupted: true });
    expect(reply!.content).toContain('401');
  });

  it('运行中：末条为用户消息时补占位回复，回复不带 finishedAt', () => {
    const projected = projectMessages(
      [{ role: 'user', content: 'hi', timestamp: 5 }] as AgentMessage[],
      undefined,
      true,
    );
    expect(projected.at(-1)).toMatchObject({ role: 'assistant', startedAt: 5 });
    expect(projected.at(-1)!.finishedAt).toBeUndefined();
  });
});

describe('会话归属与 cwd', () => {
  it('项目会话的 cwd 是项目目录；空会话入口每个项目只有一个', () => {
    state
      .db!.prepare(
        "INSERT INTO workspace_entries VALUES ('p1', NULL, '课题', 'project', NULL, ?, NULL, 'x')",
      )
      .run(state.root);
    const first = newSession('p1', 'library');
    expect(first).toMatchObject({ projectId: 'p1', cwd: state.root });
    // 项目会话不认 scope：换个 scope 也复用同一个空会话入口。
    expect(newSession('p1', 'chat').sessionId).toBe(first.sessionId);
    expect(openSession(first.sessionId!).projectId).toBe('p1');
  });

  it('随聊会话的 cwd 是存储目录下 chat-sessions/<id> 的私有目录，目录随即建好', () => {
    const chat = newSession(null, 'chat');
    const dir = join(state.root, 'Dela', 'chat-sessions', chat.sessionId!);
    expect(chat.cwd).toBe(dir);
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(newSession(null, 'chat').sessionId).toBe(chat.sessionId);
    expect(openSession(chat.sessionId!).cwd).toBe(dir);
  });

  it('资料页会话的 cwd 是课件根目录（与 workspace 平级），缺失时建好', () => {
    const courses = join(state.root, 'Dela', 'courses');
    expect(existsSync(courses)).toBe(false);
    const library = newSession(null, 'library');
    expect(library).toMatchObject({ projectId: null, cwd: courses });
    expect(statSync(courses).isDirectory()).toBe(true);
    expect(state.db!.prepare('SELECT cwd FROM sessions WHERE id=?').get(library.sessionId)).toEqual(
      { cwd: courses },
    );
  });

  it('资料页与随聊的空会话不互相复用，cwd 为 NULL 的旧会话两边都不用', () => {
    state
      .db!.prepare(
        `INSERT INTO sessions (id, project_id, file, cwd, created_at, updated_at)
         VALUES ('old-chat', NULL, '', NULL, 'x', 'x')`,
      )
      .run();
    const chat = newSession(null, 'chat');
    const library = newSession(null, 'library');
    expect(chat.sessionId).not.toBe('old-chat');
    expect(library.sessionId).not.toBe('old-chat');
    expect(library.sessionId).not.toBe(chat.sessionId);
    expect(newSession(null, 'chat').sessionId).toBe(chat.sessionId);
    expect(newSession(null, 'library').sessionId).toBe(library.sessionId);
  });

  it('新项目会话的 cwd 仍解析到项目目录，库里的 cwd 保持 NULL', () => {
    state
      .db!.prepare(
        "INSERT INTO workspace_entries VALUES ('p1', NULL, '课题', 'project', NULL, ?, NULL, 'x')",
      )
      .run(state.root);
    const session = newSession('p1', 'chat');
    expect(session.cwd).toBe(state.root);
    expect(state.db!.prepare('SELECT cwd FROM sessions WHERE id=?').get(session.sessionId)).toEqual(
      { cwd: null },
    );
  });

  it('cwd 为 NULL 的旧会话仍按老规则解析：项目会话取项目目录，通用会话取工作区根', () => {
    state
      .db!.prepare(
        "INSERT INTO workspace_entries VALUES ('p1', NULL, '课题', 'project', NULL, ?, NULL, 'x')",
      )
      .run(state.root);
    state
      .db!.prepare(
        `INSERT INTO sessions (id, project_id, file, cwd, created_at, updated_at)
         VALUES ('old-project', 'p1', '', NULL, 'x', 'x'), ('old-chat', NULL, '', NULL, 'x', 'x')`,
      )
      .run();
    expect(openSession('old-project').cwd).toBe(state.root);
    expect(openSession('old-chat').cwd).toBe(join(state.root, 'Dela', 'workspace'));
  });

  it('项目目录不存在时拒绝新建会话，不回退到其他目录', () => {
    state
      .db!.prepare(
        "INSERT INTO workspace_entries VALUES ('p2', NULL, '丢失', 'project', NULL, ?, NULL, 'x')",
      )
      .run(join(state.root, 'missing'));
    expect(() => newSession('p2', 'chat')).toThrow('项目目录不存在');
  });

  it('非项目条目不能作为会话归属', () => {
    expect(() => newSession('nope', 'chat')).toThrow('项目不存在');
  });
});

it('扩展命令原样交给 Pi，本轮不发消息时不沿用上一轮的失败结果', async () => {
  state.configured = true;
  const chat = newSession(null, 'chat');
  // 上一轮以模型报错结束。
  state.messages.push({
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage: 'old failure',
    timestamp: Date.now(),
  } as unknown as AgentMessage);
  // 扩展命令自己处理，不往会话里写消息。
  state.onPrompt = () => {
    state.messages.pop();
  };
  await askSession(chat.sessionId!, { text: '/ext-deploy now', attachments: [], context: [] });
  expect(state.prompts.at(-1)).toBe('/ext-deploy now');
  const turns = await listSessionTurnChanges(chat.sessionId!);
  expect(turns.at(-1)?.runStatus).toBe('completed');
});
