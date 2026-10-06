// 内置 Agent 能力的启停（设置 › 内置能力）：默认全开、单工具与整域开关、常驻能力保护、
// 停用即从模型工具表移除并在执行侧返回 DISABLED（含旧名别名不可绕过）。
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
  it('默认全部启用，并带上领域标签与描述', () => {
    const capabilities = listBuiltinCapabilities();
    expect(capabilities.length).toBeGreaterThan(30);
    expect(capabilities.every((capability) => capability.enabled)).toBe(true);
    const querySchedule = capabilities.find((capability) => capability.name === 'query_schedule');
    expect(querySchedule).toMatchObject({ domain: 'timetable', domainLabel: '课表与日程' });
    expect(querySchedule?.description.length).toBeGreaterThan(0);
  });

  it('承重工具标注常驻原因', () => {
    const read = listBuiltinCapabilities().find(
      (capability) => capability.name === 'read_resource',
    );
    expect(read?.enabled).toBe(true);
    expect(read?.lockedReason).toBeTruthy();
  });

  it('停用名单损坏时视为全部启用', () => {
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('tools-disabled', 'not-json')")
      .run();
    expect(enabledNames().length).toBe(listBuiltinCapabilities().length);
  });
});

describe('单工具与整域启停', () => {
  it('关闭后从模型工具表移除，执行侧返回 DISABLED', async () => {
    setBuiltinCapability('web_search', false);
    expect(enabledNames()).not.toContain('web_search');
    expect(definitionNames()).not.toContain('web_search');
    expect(await executeAgentTool('web_search', { query: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'DISABLED' },
    });
  });

  it('旧名别名不能绕过停用门禁', async () => {
    setBuiltinCapability('list_canvas_courses', false);
    expect(await executeAgentTool('find_courses', {})).toMatchObject({
      ok: false,
      error: { code: 'DISABLED' },
    });
    expect(await executeAgentTool('list_canvas_courses', {})).toMatchObject({
      ok: false,
      error: { code: 'DISABLED' },
    });
  });

  it('常驻能力拒绝关闭', () => {
    expect(() => setBuiltinCapability('read_resource', false)).toThrow('常驻');
    expect(() => setBuiltinCapability('read_skill', false)).toThrow('常驻');
    expect(listBuiltinCapabilities().find((item) => item.name === 'read_resource')?.enabled).toBe(
      true,
    );
  });

  it('未知能力与未知分组抛错', () => {
    expect(() => setBuiltinCapability('no_such_tool', false)).toThrow('能力不存在');
    expect(() => setBuiltinDomain('no-such-domain', false)).toThrow('能力分组不存在');
  });

  it('整域关闭只影响该域，恢复后回到全开', () => {
    setBuiltinDomain('mail', false);
    const afterDisable = enabledNames();
    expect(afterDisable).not.toContain('search_mail');
    expect(afterDisable).toContain('query_todos');
    setBuiltinDomain('mail', true);
    expect(enabledNames()).toContain('search_mail');
  });

  it('整域关闭跳过常驻能力', () => {
    setBuiltinDomain('common', false);
    const common = listBuiltinCapabilities().filter((item) => item.domain === 'common');
    expect(common.find((item) => item.name === 'read_resource')?.enabled).toBe(true);
    expect(common.find((item) => item.name === 'write_note')?.enabled).toBe(false);
    // 常驻能力不写入停用名单，重新启用整域后仍是全开。
    setBuiltinDomain('common', true);
    expect(enabledNames()).toContain('write_note');
  });
});
