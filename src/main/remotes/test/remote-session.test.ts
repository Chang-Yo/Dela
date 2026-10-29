// 远程会话的接线验证（不需要真实主机，也不发任何模型请求）：
// 以远端 POSIX 路径作 cwd 创建 Pi 会话要能成功，并且七个工具名下的生效定义必须是
// Dela 注入的远程版本——若同名覆盖失效，模型会拿远端路径调用 Pi 内置工具，
// 在 Windows 上就会写到 E:\root\... 这类本地盘上，后果是静默改错文件。
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolveLocal } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root, isPackaged: false } }));

import { openPiSession } from '../../agent/pi';
import { remoteTools } from '../operations';
import type { StoredLlmProvider } from '../../credentials';

const remotePath = '/root/proj';
const provider: StoredLlmProvider = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '测试',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test',
  models: ['test-model'],
  presetId: null,
  enabled: true,
};

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-remote-session-'));
});
afterEach(() => rmSync(state.root, { force: true, recursive: true }));

describe('远程会话接线', () => {
  it('cwd 用远端路径建会话，七个工具是 Dela 的远程版本且不在本地建目录', async () => {
    const session = await openPiSession({
      cwd: remotePath,
      selection: { provider, model: 'test-model', effort: null },
      appendSystemPrompt: ['远端项目 /root/proj'],
      customTools: await remoteTools(remotePath, { host: 'root@127.0.0.1', keyPath: null }),
      shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
      skillPaths: [],
      globalSkillDirs: [],
      disabledSkills: new Set(),
      disabledTools: [],
    });
    const tools = session.getAllTools();
    for (const name of ['read', 'write', 'edit', 'bash', 'ls', 'find', 'grep']) {
      expect(tools.find((tool) => tool.name === name)?.sourceInfo.source, name).toBe('sdk');
    }
    expect(session.getActiveToolNames()).toEqual(
      expect.arrayContaining(['read', 'write', 'edit', 'bash', 'ls', 'find', 'grep']),
    );
    expect(existsSync(resolveLocal(remotePath))).toBe(false);
    await session.dispose();
  }, 60_000);
});
