// 自带 OpenSSH 回退的离线部分：把系统的两个标准路径伪装成不存在，验证 Dela 真的会换用
// 随包分发的 ssh.exe。没有这一段，回退是否可用就只能靠手工在资源目录里试。
// 「这个客户端能连上真机」在 bundled-ssh.remote.test.ts，由 pnpm test:remote 运行。
import { afterEach, describe, expect, it, vi } from 'vitest';
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

import { locateSsh } from '../transport';

afterEach(() => vi.unstubAllGlobals());

describe('自带 ssh 回退', () => {
  it('系统没有 OpenSSH 时定位到自带的那份', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    expect(locateSsh()).toBe(bundled);
  });
});
