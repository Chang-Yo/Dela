// Pi 扩展在 Dela 里的运行：真实 Pi 会话加载测试夹具包，对本地 mock 模型服务发请求。覆盖
// session_start 里的通知、文本小部件与主题读取，扩展工具被模型调用，扩展命令的对话框经界面桥
// 往返，可见的自定义消息进投影而 appendEntry 与 display=false 的不进，命令报错推给界面，
// 以及包注册的 MCP 服务器经 Pi 的 MCP 扩展连上、工具能被模型调用。
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-extensions-'));
vi.mock('electron', () => ({ app: { getPath: () => root } }));
vi.mock('../../database', () => ({ getDatabase: () => null }));

import { openPiSession } from '../pi';
import {
  bindSessionExtensions,
  extensionCommand,
  releaseExtensionUi,
  sessionSlashCommands,
  shutdownSession,
} from '../extensions';
import { extensionSessionState, replyExtensionUi, setExtensionUiSender } from '../extension-ui';
import { projectMessages } from '../session';
import type { ExtensionUiEvent, ExtensionUiRequest } from '../../../shared/packages';

vi.mock('../providers', () => ({ llmProviders: () => [], usableLlmProviders: () => [] }));
vi.mock('../environment', () => ({ agentEnvironment: () => ({}) }));
vi.mock('../../settings/task-notify', () => ({ notifyRunFinished: () => {} }));
vi.mock('../packages', () => ({ packagesEnabled: () => true, recordLoadDiagnostics: () => {} }));

const fixture = join(root, 'fixture-package');
cpSync(join(import.meta.dirname, 'fixtures', 'pi-package'), fixture, { recursive: true });

const sent: { channel: string; payload: unknown }[] = [];
const events = () =>
  sent
    .filter((item) => item.channel === 'packages:ui-event')
    .map((item) => item.payload as ExtensionUiEvent);
let server: MockOpenAiServer;
let session: AgentSession;
let title = '';

beforeAll(async () => {
  setExtensionUiSender((channel, payload) => sent.push({ channel, payload }));
  server = await MockOpenAiServer.start();
  process.env.DELA_FIXTURE_MCP_SERVER = fileURLToPath(new URL('./echo-server.ts', import.meta.url));
  const cwd = mkdtempSync(join(root, 'cwd-'));
  session = await openPiSession({
    cwd,
    selection: {
      provider: {
        id: 'p',
        name: 'mock',
        baseUrl: server.baseUrl,
        apiKey: 'test-only',
        models: ['mock-model'],
        presetId: null,
        enabled: true,
      },
      model: 'mock-model',
      effort: null,
    },
    appendSystemPrompt: [],
    customTools: [],
    shellPath: process.env.SHELL ?? 'bash',
    skillPaths: [],
    globalSkillDirs: [],
    disabledSkills: new Set(),
    disabledTools: [],
    packages: [{ source: fixture, themes: [] }],
  });
  await bindSessionExtensions('s-1', session, { setTitle: (value) => (title = value) });
}, 60_000);

afterAll(async () => {
  delete process.env.DELA_FIXTURE_MCP_SERVER;
  await server?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('扩展运行时', () => {
  it('session_start 在 rpc 模式下运行：通知、文本小部件与主题都可用，TUI 接口只提示一次', () => {
    expect(events()).toContainEqual({
      type: 'notify',
      sessionId: 's-1',
      message: 'fixture started in rpc',
      level: 'info',
    });
    expect(extensionSessionState('s-1').widgets).toEqual([
      { key: 'fixture', lines: ['line one', 'line two'], placement: 'aboveEditor' },
    ]);
    expect(events()).toContainEqual({
      type: 'unsupported',
      sessionId: 's-1',
      feature: '自定义页脚',
    });
    // ctx.ui.theme.fg 没有抛错就不会出现 error 事件。
    expect(events().filter((event) => event.type === 'error')).toEqual([]);
  });

  it('扩展的工具、包里的 skill 与 prompt 模板都进了会话', () => {
    expect(session.getActiveToolNames()).toContain('fixture_echo');
    expect(session.resourceLoader.getSkills().skills.map((skill) => skill.name)).toContain(
      'fixture-skill',
    );
    expect(sessionSlashCommands(session)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'fixture-ask', kind: 'extension' }),
        expect.objectContaining({
          name: 'fixture-review',
          kind: 'prompt',
          argumentHint: '<file>',
        }),
      ]),
    );
    expect(extensionCommand(session, '/fixture-ask now')).toBe(true);
    expect(extensionCommand(session, '/fixture-review a.ts')).toBe(true);
    expect(extensionCommand(session, '/unknown')).toBe(false);
    expect(extensionCommand(session, 'hello /fixture-ask')).toBe(false);
  });

  it('模型调用扩展工具，结果回到对话', async () => {
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.toolCallDelta({
          index: 0,
          id: 'call-1',
          name: 'fixture_echo',
          arguments: '{"text":"hi"}',
        }),
        mockFrames.finishFrame('tool_calls'),
      ],
    });
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('done'), mockFrames.finishFrame('stop')],
    });
    await session.prompt('use the tool');
    const result = session.messages.find((message) => message.role === 'toolResult');
    expect(result).toMatchObject({
      toolName: 'fixture_echo',
      content: [{ type: 'text', text: 'HI' }],
    });
  });

  it('扩展命令的对话框经界面桥往返；可见消息进投影，扩展状态不进', async () => {
    const answered = new Promise<void>((resolve) => {
      setExtensionUiSender((channel, payload) => {
        sent.push({ channel, payload });
        if (channel !== 'packages:ui-request') return;
        const request = payload as ExtensionUiRequest;
        replyExtensionUi(request.id, request.kind === 'select' ? 'blue' : true);
        if (request.kind === 'confirm') resolve();
      });
    });
    await session.prompt('/fixture-ask the sky');
    await answered;
    const requests = sent
      .filter((item) => item.channel === 'packages:ui-request')
      .map((item) => item.payload as ExtensionUiRequest);
    expect(requests.map((request) => [request.kind, request.title])).toEqual([
      ['select', 'Pick a color for the sky'],
      ['confirm', 'Sure?'],
    ]);
    expect(extensionSessionState('s-1').statuses).toEqual([
      { key: 'fixture', text: 'color: blue' },
    ]);

    const projected = projectMessages(session.messages);
    const visible = projected.filter((message) => message.extension);
    expect(visible).toEqual([
      expect.objectContaining({
        content: 'picked blue true',
        extension: { customType: 'fixture' },
      }),
    ]);
    expect(projected.some((message) => message.content === 'model only')).toBe(false);
  });

  it('包注册的 MCP 服务器经 Pi 的 MCP 扩展连上，工具能被模型调用', async () => {
    const deadline = Date.now() + 10_000;
    let tool: string | undefined;
    while (!tool && Date.now() < deadline) {
      tool = session.getActiveToolNames().find((name) => name.startsWith('mcp__fixture_echo'));
      if (!tool) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(tool).toBeDefined();
    const echo = session
      .getActiveToolNames()
      .find((name) => /^mcp__fixture_echo.*echo$/.test(name))!;
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.toolCallDelta({
          index: 0,
          id: 'call-mcp',
          name: echo,
          arguments: '{"message":"hi"}',
        }),
        mockFrames.finishFrame('tool_calls'),
      ],
    });
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('ok'), mockFrames.finishFrame('stop')],
    });
    await session.prompt('use mcp');
    const result = session.messages.findLast((message) => message.role === 'toolResult');
    expect(JSON.stringify(result)).toContain('echo:hi');
  });

  it('命令抛错推给界面，带命令名', async () => {
    await session.prompt('/fixture-fail');
    expect(events()).toContainEqual({
      type: 'error',
      sessionId: 's-1',
      extension: '/fixture-fail',
      message: 'fixture command failed',
    });
  });

  it('会话被丢弃时，未答复的对话框按取消处理，界面状态清空', async () => {
    setExtensionUiSender((channel, payload) => sent.push({ channel, payload }));
    const ui = (session.extensionRunner as unknown as { uiContext: { confirm: Function } })
      .uiContext;
    const answer = ui.confirm('Leave?', 'unsaved');
    releaseExtensionUi('s-1');
    expect(await answer).toBe(false);
    expect(extensionSessionState('s-1')).toEqual({
      sessionId: 's-1',
      statuses: [],
      widgets: [],
      workingMessage: null,
    });
  });

  it('对话框超时按取消处理', async () => {
    setExtensionUiSender((channel, payload) => sent.push({ channel, payload }));
    const ui = (session.extensionRunner as unknown as { uiContext: { select: Function } })
      .uiContext;
    expect(await ui.select('wait', ['a'], { timeout: 20 })).toBeUndefined();
    expect(title).toBe('');
  });

  // 放在最后：结束会话后这个 session 不能再用。
  it('结束会话时补发 session_shutdown，扩展起的 MCP 子进程随之退出', async () => {
    await shutdownSession(session, 'quit');
    expect((globalThis as Record<string, unknown>).__delaFixtureShutdowns).toEqual(['quit']);
    // MCP 子进程的工作目录与日志都在临时目录里：进程还活着时 Windows 删不掉它。
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
});
