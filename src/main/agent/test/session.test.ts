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
  /** 假会话：每建一次实例加一；compact 的行为与是否在压缩由用例设置。 */
  opened: 0,
  disposed: 0,
  compacting: false,
  compact: null as ((instructions?: string) => Promise<unknown>) | null,
  compactCalls: [] as (string | undefined)[],
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
    opened: ++state.opened,
    subscribe: () => () => {},
    get messages() {
      return state.messages;
    },
    get isCompacting() {
      return state.compacting;
    },
    getSessionStats: () => ({ contextUsage: null }),
    dispose: () => {
      state.disposed++;
    },
    compact: async (instructions?: string) => {
      state.compactCalls.push(instructions);
      return state.compact?.(instructions);
    },
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
  shutdownSession: async (session: { dispose(): void }) => session.dispose(),
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
  contextUsageView,
  deleteSession,
  runSessionCommand,
} from '../session';
import { readChatAttachment, stageChatMedia } from '../media';
import * as changes from '../changes';
import { removeWorkspaceEntry } from '../../workspace/api';

beforeEach(() => {
  state.configured = false;
  state.messages = [];
  state.prompts = [];
  state.onPrompt = null;
  state.opened = 0;
  state.disposed = 0;
  state.compacting = false;
  state.compact = null;
  state.compactCalls = [];
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

it.each([false, true])('移除项目会删除名下全部会话与条目行 (remote=%s)', async (remote) => {
  const id = crypto.randomUUID();
  const directory = remote ? '/remote/course' : join(state.root, 'project');
  if (!remote) mkdirSync(directory);
  const remoteId = remote ? crypto.randomUUID() : null;
  state
    .db!.prepare(
      'INSERT INTO workspace_entries (id, name, kind, local_path, remote_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, 'project', 'project', directory, remoteId, 'now');
  const chat = newSession(id, 'chat');
  state
    .db!.prepare(
      'INSERT INTO sessions (id, project_id, file, archived, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    )
    .run(crypto.randomUUID(), id, '', 'now', 'now');
  await removeWorkspaceEntry(id);
  expect(state.db!.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  expect(state.db!.prepare('SELECT count(*) AS n FROM workspace_entries').get()).toEqual({
    n: 0,
  });
  expect(() => openSession(chat.sessionId!)).toThrow();
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
    comments: [],
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
    askSession(chat.sessionId!, { text: '尝试', attachments: [], context: [], comments: [] }),
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
  await askSession(chat.sessionId!, { text: '停止', attachments: [], context: [], comments: [] });
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
      "INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, remote_id, updated_at) VALUES ('remote-project', NULL, '远程', 'project', NULL, '/remote/project', 'remote-id', 'x')",
    )
    .run();
  const chat = newSession('remote-project', 'chat');
  await askSession(chat.sessionId!, {
    text: '读取远程',
    attachments: [],
    context: [],
    comments: [],
  });
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
  await askSession(chat.sessionId!, {
    text: '继续回答',
    attachments: [],
    context: [],
    comments: [],
  });
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
    comments: [],
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
  await askSession(chat.sessionId!, {
    text: '总结',
    attachments: [attachment.id],
    context: [],
    comments: [],
  });
  expect(state.prompts[0]).toContain('<attachment name="notes.txt">\n普通文本附件\n</attachment>');
});

it('只带回复评论也能发送：评论进 prompt，历史消息还原为结构化评论', async () => {
  state.configured = true;
  const chat = newSession(null, 'chat');
  const comments = [
    { quote: '复杂度是 O(n²)', comment: '为什么不是 O(n log n)？' },
    { quote: '用哈希表', comment: '' },
  ];
  const response = await askSession(chat.sessionId!, {
    text: '',
    attachments: [],
    context: [],
    comments,
  });
  expect(state.prompts[0]).toContain(
    '<comment>\n<quote>\n复杂度是 O(n²)\n</quote>\n为什么不是 O(n log n)？\n</comment>',
  );
  expect(state.prompts[0]).toContain('<comment>\n<quote>\n用哈希表\n</quote>\n\n</comment>');
  expect(response.messages[0]).toMatchObject({ role: 'user', content: '', comments });
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
        "INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, remote_id, updated_at) VALUES ('p1', NULL, '课题', 'project', NULL, ?, NULL, 'x')",
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
        "INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, remote_id, updated_at) VALUES ('p1', NULL, '课题', 'project', NULL, ?, NULL, 'x')",
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
        "INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, remote_id, updated_at) VALUES ('p1', NULL, '课题', 'project', NULL, ?, NULL, 'x')",
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
        "INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, remote_id, updated_at) VALUES ('p2', NULL, '丢失', 'project', NULL, ?, NULL, 'x')",
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
  await askSession(chat.sessionId!, {
    text: '/ext-deploy now',
    attachments: [],
    context: [],
    comments: [],
  });
  expect(state.prompts.at(-1)).toBe('/ext-deploy now');
  const turns = await listSessionTurnChanges(chat.sessionId!);
  expect(turns.at(-1)?.runStatus).toBe('completed');
});

describe('会话命令', () => {
  const titleOf = (id: string) =>
    (state.db!.prepare('SELECT title FROM sessions WHERE id=?').get(id) as { title: string }).title;

  it('/name 改标题（截到 60 字），没给标题时报出用法', async () => {
    const chat = newSession(null, 'chat');
    await runSessionCommand(chat.sessionId!, 'name', '  课程周报  ');
    expect(titleOf(chat.sessionId!)).toBe('课程周报');
    await runSessionCommand(chat.sessionId!, 'name', '长'.repeat(80));
    expect(titleOf(chat.sessionId!)).toHaveLength(60);
    await expect(runSessionCommand(chat.sessionId!, 'name', '')).rejects.toThrow('用法：/name');
  });

  it('/name 改过的标题，首条消息不再覆盖', async () => {
    state.configured = true;
    const chat = newSession(null, 'chat');
    await runSessionCommand(chat.sessionId!, 'name', '我的标题');
    await askSession(chat.sessionId!, {
      text: '第一句话',
      attachments: [],
      context: [],
      comments: [],
    });
    expect(titleOf(chat.sessionId!)).toBe('我的标题');
  });

  it('/reload 结束当前实例并立刻按新配置重建；没配模型时只结束', async () => {
    state.configured = true;
    const chat = newSession(null, 'chat');
    await askSession(chat.sessionId!, { text: '你好', attachments: [], context: [], comments: [] });
    expect(state.opened).toBe(1);
    await runSessionCommand(chat.sessionId!, 'reload', '');
    expect(state.disposed).toBe(1);
    expect(state.opened).toBe(2);

    state.configured = false;
    await runSessionCommand(chat.sessionId!, 'reload', '');
    expect(state.disposed).toBe(2);
    expect(state.opened).toBe(2);
  });

  it('/compact 带上说明交给 Pi；常见失败换成能看懂的说明；用户取消不算失败', async () => {
    state.configured = true;
    const chat = newSession(null, 'chat');
    await runSessionCommand(chat.sessionId!, 'compact', '保留接口设计的结论');
    await runSessionCommand(chat.sessionId!, 'compact', '');
    expect(state.compactCalls).toEqual(['保留接口设计的结论', undefined]);

    state.compact = async () => {
      throw new Error('Nothing to compact (session too small)');
    };
    await expect(runSessionCommand(chat.sessionId!, 'compact', '')).rejects.toThrow(
      '对话还太短，没有可压缩的内容',
    );
    state.compact = async () => {
      throw new Error('provider exploded');
    };
    await expect(runSessionCommand(chat.sessionId!, 'compact', '')).rejects.toThrow(
      '压缩失败：provider exploded',
    );
    state.compact = async () => {
      throw new Error('Compaction cancelled');
    };
    await expect(runSessionCommand(chat.sessionId!, 'compact', '')).resolves.toMatchObject({
      sessionId: chat.sessionId,
    });
  });

  it('回答进行中不执行命令，也不打断它', async () => {
    state.configured = true;
    const chat = newSession(null, 'chat');
    let finish!: () => void;
    state.onPrompt = () => new Promise<void>((resolve) => (finish = resolve));
    const ask = askSession(chat.sessionId!, {
      text: '慢慢想',
      attachments: [],
      context: [],
      comments: [],
    });
    await vi.waitFor(() => expect(state.prompts).toHaveLength(1));
    await expect(runSessionCommand(chat.sessionId!, 'compact', '')).rejects.toThrow(
      '请等待当前回答完成',
    );
    await expect(runSessionCommand(chat.sessionId!, 'reload', '')).rejects.toThrow(
      '请等待当前回答完成',
    );
    expect(state.compactCalls).toEqual([]);
    expect(state.disposed).toBe(0);
    finish();
    await ask;
  });

  it('压缩期间配置变了：不中止压缩，压缩完再丢弃实例；期间发消息给出说明', async () => {
    state.configured = true;
    const chat = newSession(null, 'chat');
    let finish!: () => void;
    state.compact = () => {
      state.compacting = true;
      return new Promise<void>((resolve) => (finish = resolve)).finally(() => {
        state.compacting = false;
      });
    };
    const compact = runSessionCommand(chat.sessionId!, 'compact', '');
    await vi.waitFor(() => expect(state.compacting).toBe(true));
    invalidateSessions();
    expect(state.disposed).toBe(0);
    await expect(
      askSession(chat.sessionId!, { text: '插一句', attachments: [], context: [], comments: [] }),
    ).rejects.toThrow('正在压缩上下文');
    finish();
    await compact;
    await vi.waitFor(() => expect(state.disposed).toBe(1));
  });
});

describe('上下文用量', () => {
  const stats = (tokens: number | null) => ({
    contextUsage: {
      tokens,
      contextWindow: 200_000,
      percent: tokens === null ? null : (tokens / 200_000) * 100,
    },
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });

  it('压缩后实际用量未知时显示估计值，有了实际用量就不再用它', () => {
    expect(contextUsageView(stats(null) as never, 30_000)).toMatchObject({
      tokens: 30_000,
      percent: 15,
      estimated: true,
    });
    expect(contextUsageView(stats(null) as never)).toMatchObject({ tokens: null, percent: null });
    const actual = contextUsageView(stats(50_000) as never, 30_000);
    expect(actual).toMatchObject({ tokens: 50_000, percent: 25 });
    expect(actual?.estimated).toBeUndefined();
  });
});
