// Pi packages 的状态与加载：用真实的 Pi 包管理与资源加载器解析测试夹具包。验证新装的包默认不启用、
// 启用后才进会话设置、按资源类型关掉的那一类不加载、主题始终不加载、卸载本地包不动用户目录。
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'dela-packages-'));
let database: DatabaseSync;
vi.mock('electron', () => ({ app: { getPath: () => root } }));
vi.mock('../../database', () => ({ getDatabase: () => database }));

import {
  disablePackages,
  enabledPackageSources,
  installPackage,
  listPackages,
  normalizeSource,
  packagesEnabled,
  readDisabledPrompts,
  removePackage,
  setPackageEnabled,
  setPromptEnabled,
  setPackageResources,
} from '../packages';
import { writeSetting } from '../../settings/prefs';

const fixture = join(root, 'fixture-package');
cpSync(join(import.meta.dirname, 'fixtures', 'pi-package'), fixture, { recursive: true });

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  // 本地来源不需要 npm：直接写开关，绕开开启时的运行时检测。
  writeSetting('pi-packages-enabled', '1');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('来源规范化', () => {
  it('本地路径转绝对路径，npm 与 git 原样交给 Pi', () => {
    expect(normalizeSource(fixture)).toEqual({ source: fixture, type: 'local' });
    expect(normalizeSource('npm:@scope/pkg@1.0.0')).toEqual({
      source: 'npm:@scope/pkg@1.0.0',
      type: 'npm',
    });
    expect(normalizeSource('git:github.com/a/b@v1').type).toBe('git');
    expect(normalizeSource('https://github.com/a/b').type).toBe('git');
    expect(() => normalizeSource(join(root, 'missing'))).toThrow(/本地路径不存在/);
    expect(() => normalizeSource('npm:')).toThrow(/缺少包名/);
  });
});

describe('安装与启停', () => {
  it('新装的包默认不启用，启用前不进会话设置', async () => {
    const [view] = await installPackage(fixture);
    expect(view).toMatchObject({
      name: 'dela-fixture-package',
      version: '1.2.3',
      type: 'local',
      enabled: false,
      installedPath: fixture,
      counts: { extensions: 1, skills: 1, prompts: 1, themes: 1 },
    });
    expect(enabledPackageSources()).toEqual([]);

    await setPackageEnabled(view!.id, true);
    // 主题是终端配色，始终过滤掉。
    expect(enabledPackageSources()).toEqual([{ source: fixture, themes: [] }]);
  });

  it('同一个包不重复登记', async () => {
    await installPackage(fixture);
    await expect(installPackage(`${fixture}/`)).rejects.toThrow(/已经安装过/);
  });

  it('关掉的资源类型写成 Pi 的空过滤', async () => {
    const [view] = await installPackage(fixture);
    await setPackageEnabled(view!.id, true);
    await setPackageResources(view!.id, { extensions: false, skills: true, prompts: false });
    expect(enabledPackageSources()).toEqual([
      { source: fixture, themes: [], extensions: [], prompts: [] },
    ]);
  });

  it('总开关关闭时一个包都不加载，记录保留', async () => {
    const [view] = await installPackage(fixture);
    await setPackageEnabled(view!.id, true);
    disablePackages();
    expect(packagesEnabled()).toBe(false);
    expect(enabledPackageSources()).toEqual([]);
    expect(await listPackages()).toHaveLength(1);
  });

  it('总开关关闭时不能安装', async () => {
    disablePackages();
    await expect(installPackage(fixture)).rejects.toThrow(/请先开启/);
  });

  it('npm 来源在没有 npm 时直接报错，不去调用 Pi', async () => {
    await expect(installPackage('npm:some-pi-package@1.0.0')).rejects.toThrow(/npm 不可用/);
  });

  it('安装目录不在了的包不进会话设置，设置页提示重新安装', async () => {
    const moved = join(root, 'moved-package');
    cpSync(fixture, moved, { recursive: true });
    const [view] = await installPackage(moved);
    await setPackageEnabled(view!.id, true);
    rmSync(moved, { recursive: true, force: true });
    expect(enabledPackageSources()).toEqual([]);
    const [listed] = await listPackages();
    expect(listed!.diagnostics).toContain('尚未安装或安装目录已被删除，请重新安装');
  });

  it('卸载本地包只取消登记，不删用户的目录', async () => {
    const [view] = await installPackage(fixture);
    expect(await removePackage(view!.id)).toEqual([]);
    expect(existsSync(join(fixture, 'package.json'))).toBe(true);
  });
});

describe('包清单', () => {
  it('未启用的包只列文件类资源，不执行扩展代码；启用后列出命令、工具与 MCP 服务器', async () => {
    process.env.DELA_FIXTURE_MCP_SERVER = fileURLToPath(
      new URL('./echo-server.ts', import.meta.url),
    );
    try {
      const [disabled] = await installPackage(fixture);
      expect(disabled!.provides).toMatchObject({
        skills: [{ name: 'fixture-skill', description: 'Fixture skill shipped by a Pi package' }],
        prompts: [{ name: 'fixture-review', argumentHint: '<file>' }],
        commands: [],
        tools: [],
        mcpServers: [],
        extensionsInspected: false,
      });
      expect(disabled!.provides.skills[0]!.path).toBe(
        join(fixture, 'skills', 'fixture-skill', 'SKILL.md'),
      );

      const [enabled] = await setPackageEnabled(disabled!.id, true);
      expect(enabled!.provides.extensionsInspected).toBe(true);
      expect(enabled!.provides.commands.map((command) => command.name).sort()).toEqual([
        'fixture-ask',
        'fixture-fail',
      ]);
      expect(enabled!.provides.tools).toEqual(['fixture_echo']);
      expect(enabled!.provides.mcpServers).toEqual([
        { name: 'fixture-echo', detail: expect.stringContaining('echo-server.ts') },
      ]);

      // 关掉扩展这一类：不再加载扩展代码，命令与工具从清单里消失。
      const [noExtensions] = await setPackageResources(disabled!.id, {
        extensions: false,
        skills: true,
        prompts: true,
      });
      expect(noExtensions!.provides).toMatchObject({
        commands: [],
        tools: [],
        extensionsInspected: false,
      });
    } finally {
      delete process.env.DELA_FIXTURE_MCP_SERVER;
    }
  });

  it('prompt 模板按名称单独开关', async () => {
    await installPackage(fixture);
    const [view] = await setPromptEnabled('fixture-review', false);
    expect(view!.disabledPrompts).toEqual(['fixture-review']);
    expect(readDisabledPrompts().has('fixture-review')).toBe(true);
    await setPromptEnabled('fixture-review', true);
    expect(readDisabledPrompts().size).toBe(0);
  });
});
