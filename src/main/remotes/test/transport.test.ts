// 传输层回归：默认在 CI 里跳过，设 DELA_REMOTE_HOST（如 root@1.2.3.4）后才真连远端。
// 需要真实主机才能验证的是命令拼装、NUL 清单解析与二进制写入往返，这些都无法用假 ssh 覆盖。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import {
  exec,
  listDirectory,
  locate,
  locateSsh,
  pathExists,
  probeRemote,
  readFile,
  shellQuote,
  writeFile,
  type RemoteTarget,
} from '../transport';

const host = process.env.DELA_REMOTE_HOST;
const target: RemoteTarget = {
  host: host ?? 'root@127.0.0.1',
  keyPath: process.env.DELA_REMOTE_KEY ?? null,
};
const live = describe.skipIf(!host);

describe('shellQuote', () => {
  it('包裹单引号并转义内部单引号', () => {
    expect(shellQuote('/root/a b')).toBe("'/root/a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

live('transport（需要 DELA_REMOTE_HOST）', () => {
  it('定位到系统或自带的 ssh.exe', () => {
    expect(locateSsh()).toMatch(/ssh\.exe$/i);
  });

  it('自检返回系统、架构与主目录', async () => {
    const probe = await probeRemote(target);
    expect(probe.system).toBe('Linux');
    expect(probe.home).toMatch(/^\//);
    expect(probe.bash).toContain('bash');
  });

  it('列目录解析 NUL 清单，含空格与中文名', async () => {
    const dir = '/tmp/dela transport 测试';
    // writeFile 自己会 mkdir -p 父目录，这里不必先建目录。
    await writeFile(target, `${dir}/a b.txt`, 'hello');
    const entries = await listDirectory(target, dir);
    const names = entries.map((entry) => entry.name).sort();
    expect(names).toEqual(['a b.txt']);
    expect(entries[0]!.directory).toBe(false);
  });

  it('读写往返保持二进制一致', async () => {
    const dir = '/tmp/dela-transport-bin';
    const bytes = Buffer.from([0, 1, 2, 250, 255, 10, 13, 0]);
    await writeFile(target, `${dir}/blob`, bytes);
    expect(await readFile(target, `${dir}/blob`)).toEqual(bytes);
  });

  it('locate 与 pathExists 区分文件、目录与不存在', async () => {
    const location = await locate(target, '/tmp');
    expect(location.directory).toBe(true);
    expect(location.entries?.length).toBeGreaterThan(0);
    expect((await locate(target, '/tmp/dela-transport-bin/blob')).directory).toBe(false);
    expect(await pathExists(target, '/tmp/dela-transport-bin')).toBe(true);
    expect(await pathExists(target, '/tmp/dela-transport-nope')).toBe(false);
  });

  it('认证或主机不可达时给出可读错误', async () => {
    const result = await exec({ host: 'root@192.0.2.1' }, 'true', { timeoutMs: 15_000 });
    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 30_000);
});
