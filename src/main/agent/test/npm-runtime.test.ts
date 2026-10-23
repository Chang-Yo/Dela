// npm 运行时：本机有够新的 npm 就用，不下载；没有时依次试镜像与官方源，任一源的 SHA256
// 不符都换下一个，全部失败时报出每个源的原因并清掉半成品目录。
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'dela-npm-runtime-'));
const spawned = vi.hoisted(() => ({
  outputs: new Map<string, string | null>(),
  calls: [] as string[],
}));

vi.mock('electron', () => ({ app: { getPath: () => root } }));
vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[]) => {
    // Windows 上 npm 经 shell 执行，命令与参数拼成一条带引号的字符串：归一成「程序名 参数」。
    const key = [command, ...args]
      .join(' ')
      .replace(/"/g, '')
      .split(' ')
      .map((part, index) => (index === 0 ? part.split(/[\\/]/).pop() : part))
      .join(' ');
    spawned.calls.push(key);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      kill: () => {},
    });
    queueMicrotask(() => {
      // tar：把解压结果造出来，交给后续的存在性检查。
      if (key.startsWith('tar')) {
        const target = args[args.indexOf('-C') + 1]!;
        const home = join(target, 'node-v24.22.1-test');
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, process.platform === 'win32' ? 'npm.cmd' : 'npm'), '');
        mkdirSync(join(home, 'bin'), { recursive: true });
        writeFileSync(join(home, 'bin', 'npm'), '');
        child.emit('close', 0);
        return;
      }
      const output = [...spawned.outputs].find(([prefix]) => key.endsWith(prefix))?.[1];
      if (output === null || output === undefined) child.emit('error', new Error('ENOENT'));
      else {
        child.stdout.emit('data', Buffer.from(output));
        child.emit('close', 0);
      }
    });
    return child;
  },
}));

import { ensureNpmRuntime, locateNpm, NODE_VERSION } from '../npm-runtime';

beforeEach(() => {
  spawned.outputs.clear();
  spawned.calls.length = 0;
  rmSync(join(root, 'components'), { recursive: true, force: true });
  vi.unstubAllGlobals();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

it('uses a system npm backed by Node 20+ without downloading', async () => {
  spawned.outputs.set('npm --version', '11.6.0\n');
  spawned.outputs.set('node --version', 'v22.3.0\n');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const runtime = await ensureNpmRuntime(() => {});
  expect(runtime).toEqual({ command: ['npm'], version: '11.6.0', origin: 'system' });
  expect(fetch).not.toHaveBeenCalled();
});

it('treats a system npm on an old Node as missing', async () => {
  spawned.outputs.set('npm --version', '6.14.0\n');
  spawned.outputs.set('node --version', 'v14.21.0\n');
  expect(await locateNpm()).toBeNull();
});

it('falls back to the next source on checksum mismatch and reports every failure', async () => {
  const fetch = vi.fn(
    async (_url: string) => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetch);
  const states: string[] = [];
  await expect(ensureNpmRuntime((state) => states.push(state.status))).rejects.toThrow(
    /registry\.npmmirror\.com：SHA256 不符.*nodejs\.org：SHA256 不符/,
  );
  expect(fetch.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual([
    'registry.npmmirror.com',
    'nodejs.org',
  ]);
  expect(String(fetch.mock.calls[0]![0])).toContain(`/v${NODE_VERSION}/`);
  expect(states.at(-1)).toBe('error');
  expect(existsSync(join(root, 'components', 'node', `v${NODE_VERSION}`))).toBe(false);
});
