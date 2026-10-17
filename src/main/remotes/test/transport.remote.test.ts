// 传输层真机回归：命令拼装、NUL 清单解析与二进制写入往返，这些都无法用假 ssh 覆盖。
// 需要 DELA_REMOTE_HOST（如 root@1.2.3.4），由 pnpm test:remote 运行，不在默认 pnpm test 与 CI 里。
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
  writeFile,
  type RemoteTarget,
} from '../transport';

const target: RemoteTarget = {
  host: process.env.DELA_REMOTE_HOST!,
  keyPath: process.env.DELA_REMOTE_KEY ?? null,
};

describe('transport（真机）', () => {
  it('定位到对应平台的 SSH 客户端', () => {
    expect(locateSsh()).toMatch(process.platform === 'darwin' ? /\/usr\/bin\/ssh$/ : /ssh\.exe$/i);
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
