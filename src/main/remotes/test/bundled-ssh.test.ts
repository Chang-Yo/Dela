// 自带 OpenSSH 回退：把系统的两个标准路径伪装成不存在，验证 Dela 真的会换用随包分发的
// ssh.exe，并且这个客户端能连上真机。没有这一段，回退是否可用就只能靠手工在资源目录里试。
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const bundled = join(process.cwd(), 'vendor', 'openssh', 'ssh.exe');
const systemPaths = [
  join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'OpenSSH', 'ssh.exe'),
];

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));
// 只把「系统装的 OpenSSH」当成不存在，其余文件系统照旧。
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) =>
      systemPaths.includes(String(path)) ? false : actual.existsSync(path),
  };
});

import { exec, locateSsh } from '../transport';

const host = process.env.DELA_REMOTE_HOST;

describe('自带 ssh 回退', () => {
  it('随包带了 ssh.exe 与它唯一的非系统依赖 libcrypto.dll', () => {
    expect(existsSync(bundled)).toBe(true);
    expect(existsSync(join(process.cwd(), 'vendor', 'openssh', 'libcrypto.dll'))).toBe(true);
  });

  it('系统没有 OpenSSH 时定位到自带的那份', () => {
    expect(locateSsh()).toBe(bundled);
  });
});

describe.skipIf(!host)('自带 ssh 回退（需要 DELA_REMOTE_HOST）', () => {
  it('用自带的客户端真连一次远端', async () => {
    const result = await exec(
      { host: host!, keyPath: process.env.DELA_REMOTE_KEY ?? null },
      'echo bundled-ok',
    );
    expect(result.stdout.toString().trim()).toBe('bundled-ok');
    expect(result.code).toBe(0);
  }, 60_000);
});
