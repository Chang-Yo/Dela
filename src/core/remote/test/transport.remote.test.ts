// ssh 边界的真机回归：客户端定位、自检与错误。远程项目的读写与目录都经 helper，见 helper.remote.test.ts。
// 需要 DELA_REMOTE_HOST（如 root@1.2.3.4），由 pnpm test:remote 运行，不在默认 pnpm test 与 CI 里。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { exec, locateSsh, probeRemote, type RemoteTarget } from '../transport';

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

  it('认证或主机不可达时给出可读错误', async () => {
    const result = await exec({ host: 'root@192.0.2.1' }, 'true', { timeoutMs: 15_000 });
    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 30_000);
});
