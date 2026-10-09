// 远程工具的回归：默认在 CI 跳过，设 DELA_REMOTE_HOST（如 root@1.2.3.4）后才真连远端。
// 最关键的一组用宿主 resolve 生成「工具实际会传进来的路径」，验证它们确实落到远端，
// 并且不会在本地盘上创建同名文件——路径归一化写错的后果就是静默改错文件。
import { existsSync } from 'node:fs';
import { resolve as resolveLocal } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { remoteGrepTool, remoteOperations, remotePath, setContextMirrors } from '../operations';
import { exec, shellQuote, type RemoteTarget } from '../transport';

const host = process.env.DELA_REMOTE_HOST;
const target: RemoteTarget = {
  host: host ?? 'root@127.0.0.1',
  keyPath: process.env.DELA_REMOTE_KEY ?? null,
};
const live = describe.skipIf(!host);
const root = '/tmp/dela-tools-test';
/** 工具传进来的形态：Windows 上 resolve 会把 POSIX 绝对路径挂到当前盘。 */
const mangled = (path: string) => resolveLocal(path);

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

live('远程工具（需要 DELA_REMOTE_HOST）', () => {
  const ops = remoteOperations(target);

  beforeAll(async () => {
    // 建目录这一步不能用它自己当 cwd：目录还不存在时 helper 会以 bad_cwd 拒掉。
    await ops.bash.exec(`mkdir -p ${shellQuote(root)} && rm -rf ${shellQuote(root)}/*`, '/', {
      onData: () => {},
    });
    await ops.write.writeFile(`${root}/a b.txt`, '你好 remote\n');
    await ops.bash.exec(`mkdir -p ${shellQuote(`${root}/sub`)}`, root, { onData: () => {} });
  });

  const run = async (command: string) =>
    new Promise<{ output: string; exitCode: number | null }>((resolve) => {
      let output = '';
      void ops.bash
        .exec(command, root, {
          onData: (chunk) => {
            output += chunk.toString();
          },
        })
        .then((result) => resolve({ output, exitCode: result.exitCode }));
    });

  it('bash 在远端目录执行并合并 stderr', async () => {
    const result = await run('pwd; echo "$HOME"; echo 出错了 >&2');
    expect(result.output.split('\n')[0]).toBe(root);
    expect(result.output).toContain('/root');
    expect(result.output).toContain('出错了');
    expect(result.exitCode).toBe(0);
  });

  it('bash 返回非零退出码而不抛错', async () => {
    const result = await run('exit 7');
    expect(result.exitCode).toBe(7);
  });

  it('写入与读取走远端，且不在本地盘留下同名路径', async () => {
    const path = `${root}/written.txt`;
    await ops.write.writeFile(mangled(path), '你好 remote\n');
    expect(existsSync(mangled(path))).toBe(false);
    const back = await ops.read.readFile(mangled(path));
    expect(back.toString()).toBe('你好 remote\n');
  });

  it('access 对不存在的文件报错', async () => {
    await expect(ops.read.access(mangled(`${root}/nope.txt`))).rejects.toThrow(/不存在|不可读/);
  });

  it('识别图片 MIME（按扩展名，不多跑一次 ssh）', async () => {
    await expect(ops.read.detectImageMimeType('/root/a.png')).resolves.toBe('image/png');
    await expect(ops.read.detectImageMimeType('/root/a.ts')).resolves.toBeNull();
  });

  it('ls 的 readdir 与逐条 stat 一致（stat 命中清单缓存）', async () => {
    const names = await ops.ls.readdir(mangled(root));
    expect(names).toContain('a b.txt');
    expect(names).toContain('sub');
    const fileStat = await ops.ls.stat(mangled(`${root}/a b.txt`));
    const dirStat = await ops.ls.stat(mangled(`${root}/sub`));
    expect(fileStat.isDirectory()).toBe(false);
    expect(dirStat.isDirectory()).toBe(true);
    expect(await ops.ls.exists(mangled(`${root}/nope`))).toBe(false);
  });

  it('stat 对未列过的路径仍能回答', async () => {
    const stat = await ops.ls.stat('/tmp');
    expect(stat.isDirectory()).toBe(true);
    await expect(ops.ls.stat('/tmp/dela-not-here-9f3')).rejects.toThrow(/不存在/);
  });

  it('find 的 glob 返回相对路径并支持 ** 与 *', async () => {
    const flat = await ops.find.glob('*.txt', mangled(root), { ignore: [], limit: 100 });
    expect(flat).toContain('a b.txt');
    const nested = await ops.find.glob('**/deep/*.md', mangled(root), { ignore: [], limit: 100 });
    expect(nested).toEqual([]);
  });

  it('edit 的读改写组合可用', async () => {
    const path = `${root}/edit.txt`;
    await ops.write.writeFile(mangled(path), 'old\n');
    const buffer = await ops.edit.readFile(mangled(path));
    await ops.edit.writeFile(mangled(path), buffer.toString().replace('old', 'new'));
    expect((await ops.read.readFile(mangled(path))).toString()).toBe('new\n');
  });

  it('grep 工具在远端搜索并给出 file:line 结果', async () => {
    const tool = await remoteGrepTool(root, target);
    const result = (await tool.execute!(
      'call-1',
      { pattern: 'remote', path: mangled(root) },
      undefined,
      undefined,
      { cwd: root } as never,
    )) as { content: { type: string; text: string }[] };
    const text = result.content.map((part) => part.text).join('');
    expect(text).toContain('a b.txt:1:');
    expect(text).toContain('你好 remote');
  }, 60_000);

  it('grep 工具在无匹配时返回 No matches found', async () => {
    const tool = await remoteGrepTool(root, target);
    const result = (await tool.execute!(
      'call-2',
      { pattern: '不可能出现的字符串9f3a', path: mangled(root) },
      undefined,
      undefined,
      { cwd: root } as never,
    )) as { content: { type: string; text: string }[] };
    expect(result.content[0]!.text).toBe('No matches found');
  }, 60_000);

  it('工具调用真的走 helper 通道，而不是悄悄退回一次性 ssh', async () => {
    await run('echo channel-check');
    const alive = await exec(target, 'pgrep -f "[d]ela-helper --port" | wc -l');
    expect(Number(alive.stdout.toString().trim())).toBeGreaterThan(0);
  }, 60_000);

  it('bash 超时映射成 Pi 认的 timeout 前缀', async () => {
    await expect(ops.bash.exec('sleep 30', root, { onData: () => {}, timeout: 1 })).rejects.toThrow(
      'timeout:1',
    );
  }, 60_000);

  it('输出被远端丢弃时补一条说明，不假装完整', async () => {
    let output = '';
    const result = await ops.bash.exec('head -c 9000000 /dev/zero | base64', root, {
      onData: (chunk) => {
        output += chunk.toString();
      },
    });
    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/已丢弃 \d+ 字节/);
  }, 120_000);
});
