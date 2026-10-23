// 远程工具的离线回归：路径还原与镜像翻译。工具真的落到远端的判断需要真机，
// 在 operations.remote.test.ts，由 pnpm test:remote 运行。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { mirrorCommandText, remotePath, setContextMirrors } from '../operations';

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

  it('POSIX 镜像区分大小写，保留目录和文件名里的反斜杠', () => {
    const mirror = '/Users/me/课程\\资料/repo';
    setContextMirrors('mac', [{ mirror, remote: '/srv/Project' }]);
    try {
      expect(remotePath(`${mirror}/读\\我.md`)).toBe('/srv/Project/读\\我.md');
      expect(remotePath(mirror)).toBe('/srv/Project');
      expect(remotePath(`${mirror.toLowerCase()}/SKILL.md`)).toBe(
        `${mirror.toLowerCase()}/SKILL.md`,
      );
      expect(remotePath(`${mirror}-other/SKILL.md`)).toBe(`${mirror}-other/SKILL.md`);
      expect(remotePath('/srv/Project/读\\我.md')).toBe('/srv/Project/读\\我.md');
    } finally {
      setContextMirrors('mac', []);
    }
  });
});

describe('mirrorCommandText', () => {
  it('Mac 镜像按原样匹配，不改同名异大小写或前缀相似的其他目录', () => {
    const mirror = '/Users/me/课程\\资料/repo';
    setContextMirrors('mac', [{ mirror, remote: '/srv/Project' }]);
    try {
      expect(mirrorCommandText(`cat '${mirror}/读\\我.md'`)).toBe("cat '/srv/Project/读\\我.md'");
      expect(mirrorCommandText(`cd '${mirror}' && pwd`)).toBe("cd '/srv/Project' && pwd");
      const other = `cat '${mirror.toLowerCase()}/SKILL.md' '${mirror}-other/SKILL.md'`;
      expect(mirrorCommandText(other)).toBe(other);
    } finally {
      setContextMirrors('mac', []);
    }
  });

  it('Windows 镜像仍兼容大小写及混合分隔符，不匹配前缀相似的其他目录', () => {
    setContextMirrors('win', [{ mirror: 'C:\\Users\\me\\repo', remote: '/srv/project' }]);
    try {
      expect(mirrorCommandText("cat 'c:/users/ME/repo\\skills\\SKILL.md'")).toBe(
        "cat '/srv/project/skills/SKILL.md'",
      );
      const other = "cat 'C:/Users/me/repo-other/SKILL.md'";
      expect(mirrorCommandText(other)).toBe(other);
    } finally {
      setContextMirrors('win', []);
    }
  });
});
