// 内置 Agent 能力的启停（设置 › 内置能力）：九个内核工具、默认禁用网络域、单工具与
// 整域开关、ReadSkills 常驻保护、停用即从模型工具表移除并在执行侧返回 DISABLED。
// 数据库用真实 database.ts（electron app.getPath 指向临时目录），与 skills/mcp 测试一致。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
import { closeDatabase, getDatabase } from '../../../database';
import { listBuiltinCapabilities, setBuiltinCapability, setBuiltinDomain } from '../tools';
import { executeAgentTool, modelToolDefinitions } from '../../tools/registry';

function enabledNames(): string[] {
  return listBuiltinCapabilities()
    .filter((capability) => capability.enabled)
    .map((capability) => capability.name);
}

function definitionNames(): string[] {
  return modelToolDefinitions().map(({ function: definition }) => definition.name);
}

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-tools-'));
  getDatabase()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('directory', ?)")
    .run(state.root);
});

afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

beforeEach(() => {
  getDatabase().prepare("DELETE FROM workspace_settings WHERE key='tools-disabled'").run();
});

describe('内置能力清单', () => {
  it('列出九个内核工具；网络域默认停用，基础域默认启用', () => {
    const capabilities = listBuiltinCapabilities();
    expect(capabilities.map(({ name }) => name).sort()).toEqual(
      [
        'Read',
        'Write',
        'Edit',
        'Grep',
        'Glob',
        'Bash',
        'WebFetch',
        'WebSearch',
        'ReadSkills',
      ].sort(),
    );
    expect(enabledNames().sort()).toEqual(
      ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'ReadSkills'].sort(),
    );
    const bash = capabilities.find((capability) => capability.name === 'Bash');
    expect(bash).toMatchObject({ domain: 'core', domainLabel: '基础' });
    expect(bash?.description.length).toBeGreaterThan(0);
  });

  it('ReadSkills 与内核四工具标注常驻原因', () => {
    const capabilities = listBuiltinCapabilities();
    for (const name of ['Read', 'Write', 'Edit', 'Bash', 'ReadSkills']) {
      const item = capabilities.find((capability) => capability.name === name);
      expect(item?.enabled).toBe(true);
      expect(item?.lockedReason).toBeTruthy();
    }
  });

  it('停用名单损坏时回到默认（网络域停用）', () => {
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('tools-disabled', 'not-json')")
      .run();
    expect(enabledNames()).not.toContain('WebFetch');
    expect(enabledNames()).toContain('Read');
  });
});

describe('单工具与整域启停', () => {
  it('关闭后从模型工具表移除，执行侧返回 DISABLED；开启网络域后进入工具表', async () => {
    setBuiltinCapability('Grep', false);
    expect(enabledNames()).not.toContain('Grep');
    expect(definitionNames()).not.toContain('Grep');
    expect(await executeAgentTool('Grep', { pattern: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'DISABLED' },
    });
    setBuiltinCapability('WebFetch', true);
    expect(definitionNames()).toContain('WebFetch');
    // Grep 与 WebSearch 仍停用，其余启用。
    expect(enabledNames()).not.toContain('Grep');
    expect(enabledNames()).not.toContain('WebSearch');
    expect(enabledNames()).toContain('Read');
  });

  it('校园业务名按 UNKNOWN_TOOL 拒绝（引导模型走 dela 命令）', async () => {
    expect(await executeAgentTool('query_todos', {})).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_TOOL' },
    });
  });

  it('常驻能力拒绝关闭（ReadSkills 与内核四工具）', () => {
    for (const name of ['ReadSkills', 'Read', 'Write', 'Edit', 'Bash']) {
      expect(() => setBuiltinCapability(name, false)).toThrow('常驻');
      expect(listBuiltinCapabilities().find((item) => item.name === name)?.enabled).toBe(true);
    }
  });

  it('未知能力与未知分组抛错', () => {
    expect(() => setBuiltinCapability('no_such_tool', false)).toThrow('能力不存在');
    expect(() => setBuiltinDomain('no-such-domain', false)).toThrow('能力分组不存在');
  });

  it('整域关闭只影响该域，常驻能力跳过；恢复后回到该域全开', () => {
    setBuiltinDomain('core', false);
    const afterDisable = enabledNames();
    expect(afterDisable).not.toContain('Grep'); // core 域唯一可开关项
    expect(afterDisable).toContain('Bash'); // 常驻能力跳过
    expect(afterDisable).toContain('ReadSkills');
    setBuiltinDomain('core', true);
    expect(enabledNames()).toContain('Grep');
  });

  it('整域开启网络域后 WebFetch/WebSearch 进入工具表', () => {
    setBuiltinDomain('web', true);
    expect(enabledNames()).toContain('WebFetch');
    expect(enabledNames()).toContain('WebSearch');
    setBuiltinDomain('web', false);
    expect(enabledNames()).not.toContain('WebSearch');
  });
});
