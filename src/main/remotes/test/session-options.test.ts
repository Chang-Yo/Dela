// 远程会话必须是「七个远程工具 + 本机工具（联网/MCP）」，且不能带 dela 命令桥：工具名一旦被
// excludeTools 过滤，同名覆盖就会失效，模型会拿远端路径调用 Pi 内置工具，在 Windows 上写到本地盘。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const state = vi.hoisted(() => ({
  remote: true,
  disabled: new Set<string>(['web_fetch', 'read']),
}));

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\data' } }));
vi.mock('../../database', () => ({
  getDatabase: () => ({
    prepare: () => ({ get: () => ({ name: '课题' }), all: () => [] }),
  }),
}));
vi.mock('../../storage', () => ({ storageDirectory: () => 'C:\\data' }));
vi.mock('../../settings/prefs', () => ({ getAgentInstruction: () => '' }));
vi.mock('../../workspace/api', () => ({
  remoteProjectOf: (id: string) => (state.remote && id === 'p-remote' ? { remoteId: 'r1' } : null),
}));
vi.mock('../api', () => ({
  remoteById: () => ({
    id: 'r1',
    label: 'gpu',
    host: 'root@10.0.0.5',
    port: null,
    keyPath: null,
    createdAt: '',
  }),
  targetOf: () => ({ host: 'root@10.0.0.5', keyPath: null }),
}));
// 真实实现要动态加载 Pi（纯 ESM）：这里只关心名字与组合，工具体换成空壳。
vi.mock('../operations', () => ({
  remoteTools: async (_cwd: string, _target: unknown): Promise<ToolDefinition[]> =>
    ['read', 'write', 'edit', 'bash', 'ls', 'find', 'grep'].map((name) => ({
      name,
      label: name,
      description: `${name}（远端）`,
      parameters: { type: 'object' } as unknown as ToolDefinition['parameters'],
      execute: async () => ({ content: [], details: undefined }),
    })),
}));
// 镜像要真的 ssh：这里只验证「镜像结果怎么接给 Pi」。
vi.mock('../context', () => ({
  syncRemoteContext: async () => ({
    skillPaths: [
      'C:\\data\\remote-context\\r1\\p-remote\\repo\\.agents\\skills',
      'C:\\data\\remote-context\\r1\\p-remote\\home\\.dela\\skills',
    ],
    agentsFiles: [{ path: '/root/proj/AGENTS.md', content: '暗号：菠萝' }],
  }),
}));
vi.mock('../../agent/commands', () => ({
  COMMAND_BRIDGE: 'dela() { :; }',
  startDomainBridge: () => ({ url: 'http://127.0.0.1:1', token: 'token' }),
}));
vi.mock('../../terminal', () => ({ locateBash: () => 'C:\\Git\\bash.exe' }));
// 远程会话与本地会话一样带上已启用的 Pi packages（扩展代码在本机运行）。
vi.mock('../../agent/packages', () => ({
  enabledPackageSources: () => [{ source: 'C:\\pkgs\\demo', themes: [] }],
  packageNpmCommand: () => undefined,
  readDisabledPrompts: () => new Set<string>(),
}));
vi.mock('../../agent/skills', () => ({
  builtinSkillsDirectory: () => 'C:\\skills',
  ensureBuiltinSkills: () => {},
  effectiveDisabledSkills: () => new Set<string>(),
  globalSkillDirectories: () => ['C:\\skills'],
  readDisabledSkillPaths: () => new Set<string>(),
}));
vi.mock('../../agent/mcp', () => ({ mcpToolDefinitions: () => [], executeMcpTool: vi.fn() }));
vi.mock('../../agent/tools', () => ({ readDisabledTools: () => state.disabled }));

import { agentEnvironment } from '../../agent/environment';

const names = (tools: ToolDefinition[]) => tools.map((tool) => tool.name).sort();

beforeEach(() => {
  state.remote = true;
  state.disabled = new Set(['web_fetch', 'read']);
});

describe('远程会话环境', () => {
  it('给七个远程工具加本机工具，且不带 dela 命令桥', async () => {
    const options = await agentEnvironment().sessionOptions('p-remote', '/root/proj');
    expect(names(options.customTools)).toEqual(
      ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'web_fetch', 'web_search', 'write'].sort(),
    );
    expect(options.commandPrefix).toBeUndefined();
    expect(options.appendSystemPrompt.join('\n')).toContain('远端项目目录：/root/proj');
    expect(options.appendSystemPrompt.join('\n')).not.toContain('dela help');
  });

  it('用户关掉的能力名单不会波及七个工具名', async () => {
    const options = await agentEnvironment().sessionOptions('p-remote', '/root/proj');
    // web_fetch 仍按用户设置剔除；read 是内置名，必须保留（否则同名覆盖失效）。
    expect([...options.disabledTools]).toEqual(['web_fetch']);
  });

  it('只挂镜像里的远端技能，不挂本地校园技能', async () => {
    const options = await agentEnvironment().sessionOptions('p-remote', '/root/proj');
    expect(options.skillPaths).toEqual([
      'C:\\data\\remote-context\\r1\\p-remote\\repo\\.agents\\skills',
      'C:\\data\\remote-context\\r1\\p-remote\\home\\.dela\\skills',
    ]);
    expect(options.skillPaths).not.toContain('C:\\skills');
    // 镜像里的远端技能与本机全局技能一样按名称开关。
    expect(options.globalSkillDirs).toEqual(expect.arrayContaining(options.skillPaths));
  });

  it('远端 AGENTS.md 的内容与远端路径一起注入，本地全局上下文不丢', async () => {
    const options = await agentEnvironment().sessionOptions('p-remote', '/root/proj');
    const base = [{ path: 'C:\\data\\AGENTS.md', content: '全局' }];
    expect(options.agentsFilesOverride!({ agentsFiles: base })).toEqual({
      agentsFiles: [...base, { path: '/root/proj/AGENTS.md', content: '暗号：菠萝' }],
    });
  });

  it('已启用的 Pi packages 照常加载', async () => {
    const options = await agentEnvironment().sessionOptions('p-remote', '/root/proj');
    expect(options.packages).toEqual([{ source: 'C:\\pkgs\\demo', themes: [] }]);
  });
});

describe('本地会话环境', () => {
  it('保留 dela 命令桥与内置工具，不给远程工具', async () => {
    state.remote = false;
    const options = await agentEnvironment().sessionOptions('p-local', 'E:\\proj');
    expect(names(options.customTools)).toEqual(['web_fetch', 'web_search']);
    expect(options.commandPrefix).toContain('DELA_COMMAND_URL');
  });
});
