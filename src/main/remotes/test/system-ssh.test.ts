import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ exists: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: state.exists }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app' } }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
  state.exists.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('macOS 的 ssh 与 sftp 均来自系统路径，不依赖 PATH 或 Windows 资源', async () => {
  const ssh = join('/usr/bin', 'ssh');
  const sftp = join('/usr/bin', 'sftp');
  state.exists.mockImplementation((path: string) => path === ssh || path === sftp);
  const { locateSsh } = await import('../transport');
  expect(locateSsh()).toBe(ssh);
  expect(locateSsh('sftp')).toBe(sftp);
  expect(state.exists.mock.calls.map(([path]) => path)).toEqual([ssh, sftp]);
});

it('缺少 macOS 系统客户端时不误用随包 exe，并给出对应平台提示', async () => {
  state.exists.mockImplementation((path: string) => path.endsWith('.exe'));
  const { locateSsh } = await import('../transport');
  expect(() => locateSsh()).toThrow('macOS 系统 SSH 客户端');
});
