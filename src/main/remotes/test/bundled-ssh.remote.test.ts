// 自带 OpenSSH 回退的真机验证：系统没有 OpenSSH 时，随包分发的 ssh.exe 真的能连上远端。
// 需要 DELA_REMOTE_HOST（如 root@1.2.3.4），由 pnpm test:remote 运行，不在默认 pnpm test 与 CI 里。
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

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

import { exec } from '../transport';

describe('自带 ssh 回退（真机）', () => {
  it('用自带的客户端真连一次远端', async () => {
    const result = await exec(
      { host: process.env.DELA_REMOTE_HOST!, keyPath: process.env.DELA_REMOTE_KEY ?? null },
      'echo bundled-ok',
    );
    expect(result.stdout.toString().trim()).toBe('bundled-ok');
    expect(result.code).toBe(0);
  }, 60_000);
});
