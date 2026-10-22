// Pi 扩展在 Dela 里的运行：真实 Pi 会话加载测试夹具包，对本地 mock 模型服务发请求。覆盖
// session_start 里的通知、文本小部件与主题读取，扩展工具被模型调用，扩展命令的对话框经界面桥
// 往返，可见的自定义消息进投影而 appendEntry 与 display=false 的不进，以及命令报错推给界面。
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
} from '../extensions';
import { extensionSessionState, replyExtensionUi, setExtensionUiSender } from '../extension-ui';
import { projectMessages } from '../session';
import type { ExtensionUiEvent, ExtensionUiRequest } from '../../../shared/packages';

vi.mock('../providers', () => ({ getActiveLlmProvider: () => null }));
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
  const cwd = mkdtempSync(join(root, 'cwd-'));
  session = await openPiSession({
    cwd,
    provider: {
      id: 'p',
      name: 'mock',
      baseUrl: server.baseUrl,
      apiKey: 'test-only',
      models: ['mock-model'],
      model: 'mock-model',
      effortLevels: [],
      presetId: null,
    },
    appendSystemPrompt: [],
    customTools: [],
    shellPath: process.env.SHELL ?? 'bash',
    skillPaths: [],
    disabledSkills: new Set(),
    disabledTools: [],
    packages: [{ source: fixture, themes: [] }],
  });
  await bindSessionExtensions('s-1', session, { setTitle: (value) => (title = value) });
}, 60_000);

afterAll(async () => {
  session?.dispose();
  await server?.close();
  rmSync(root, { recursive: true, force: true });
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
});
