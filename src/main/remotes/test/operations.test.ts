// 远程工具的离线回归：还原被宿主 node:path 改写过的远端路径、通道调用失败后的退化策略。
// 「写入真的落到远端、不在本地盘留下同名路径」这类判断需要真机，在 operations.remote.test.ts，
// 由 pnpm test:remote 运行。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

/** 假会话：list 抛错即「这次通道调用失败」。 */
let session: { list: (path: string) => Promise<unknown> } | null = null;
const calls: string[] = [];

vi.mock('../helper', () => ({
  helperSession: async () => session,
  // 真实现会先探活再决定拆不拆通道（见 helper.ts 与 helper.test.ts），这里只断言调用顺序与目标。
  discardHelperIfDead: async (target: { host: string }) => {
    calls.push(`probe:${target.host}`);
  },
  HelperHttpError: class HelperHttpError extends Error {},
}));

vi.mock('../transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../transport')>()),
  listDirectory: async () => {
    calls.push('ssh');
    return [];
  },
}));

import { listRemoteDirectory, remotePath, setContextMirrors } from '../operations';

const target = { host: 'user@10.0.0.5', keyPath: null };

beforeEach(() => {
  calls.length = 0;
  session = null;
});

describe('remotePath', () => {
  it('还原被 node:path 改写过的远端路径', () => {
    // 本机实测：cwd=/root/proj 时相对路径 src/a.ts 会被解析成 E:\root\proj\src\a.ts
    expect(remotePath('E:\\root\\proj\\src\\a.ts')).toBe('/root/proj/src/a.ts');
    // 绝对路径 /tmp/x 会变成 \tmp\x
    expect(remotePath('\\tmp\\x')).toBe('/tmp/x');
    expect(remotePath('/root/proj/')).toBe('/root/proj');
    expect(remotePath('/')).toBe('/');
    expect(remotePath('//root//a')).toBe('/root/a');
  });

  it('镜像路径翻回远端真身，普通远端路径不受影响', () => {
    const mirror = 'C:\\Users\\me\\AppData\\Roaming\\dela\\remote-context\\r1\\p1';
    setContextMirrors('r1:p1', [
      { mirror: `${mirror}\\repo`, remote: '/root/proj' },
      { mirror: `${mirror}\\home`, remote: '/root' },
    ]);
    try {
      // 模型从技能的 <location> 里拿到的是镜像路径
      expect(remotePath(`${mirror}\\repo\\.agents\\skills\\lint\\SKILL.md`)).toBe(
        '/root/proj/.agents/skills/lint/SKILL.md',
      );
      // 大小写与混合分隔符都要认（Windows 盘符大小写不定）
      expect(remotePath(`${mirror.toLowerCase()}/home/.dela/skills/x/SKILL.md`)).toBe(
        '/root/.dela/skills/x/SKILL.md',
      );
      // 镜像根本身
      expect(remotePath(`${mirror}\\repo`)).toBe('/root/proj');
      // 远端绝对路径、被改写的相对路径都照旧
      expect(remotePath('/tmp/x')).toBe('/tmp/x');
      expect(remotePath('E:\\root\\proj\\src\\a.ts')).toBe('/root/proj/src/a.ts');
    } finally {
      setContextMirrors('r1:p1', []);
    }
    expect(remotePath(`${mirror}\\repo\\.agents\\skills\\lint\\SKILL.md`)).toBe(
      '/Users/me/AppData/Roaming/dela/remote-context/r1/p1/repo/.agents/skills/lint/SKILL.md',
    );
  });

  it('多个项目并存时取最长前缀', () => {
    setContextMirrors('a', [{ mirror: 'C:\\mirror\\p', remote: '/srv/p' }]);
    setContextMirrors('b', [{ mirror: 'C:\\mirror\\p\\sub', remote: '/srv/deep' }]);
    try {
      expect(remotePath('C:\\mirror\\p\\sub\\x.md')).toBe('/srv/deep/x.md');
      expect(remotePath('C:\\mirror\\p\\y.md')).toBe('/srv/p/y.md');
    } finally {
      setContextMirrors('a', []);
      setContextMirrors('b', []);
    }
  });
});

// 多个会话共用一条通道：一次失败只该降级这一次调用，不能顺手把通道拆掉——helper 靠请求上下文
// 断开取消进程组，隧道一断，别的会话正在远端跑的命令会被一起 TERM。
describe('通道失败后的退化', () => {
  it('失败时先按目标探活再回退，不无条件拆通道', async () => {
    session = {
      list: async () => {
        throw new Error('隧道半死');
      },
    };
    expect(await listRemoteDirectory(target, '/home/u/proj')).toEqual([]);
    expect(calls).toEqual([`probe:${target.host}`, 'ssh']);
  });

  it('业务错误不是通道故障：不探活也不回退', async () => {
    const { HelperHttpError } = await import('../helper');
    session = {
      list: async () => {
        throw new HelperHttpError('远端文件不存在：/home/u/proj/x', 404);
      },
    };
    await expect(listRemoteDirectory(target, '/home/u/proj')).rejects.toThrow('远端文件不存在');
    expect(calls).toEqual([]);
  });
});
