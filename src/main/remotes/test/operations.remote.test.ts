// 远程工具的真机回归：bash/读写/stat/glob/grep/edit、超时与输出丢弃说明。
// 需要 DELA_REMOTE_HOST（如 root@1.2.3.4），由 pnpm test:remote 运行，不在默认 pnpm test 与 CI 里。
import { existsSync } from 'node:fs';
import { resolve as resolveLocal } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import {
  listRemoteDirectory,
  readRemoteRange,
  remoteGrepTool,
  remoteOperations,
  statRemoteFile,
} from '../operations';
import { onRemoteChange } from '../events';
import { exec, shellQuote, type RemoteTarget } from '../transport';

const target: RemoteTarget = {
  host: process.env.DELA_REMOTE_HOST!,
  keyPath: process.env.DELA_REMOTE_KEY ?? null,
};
const root = '/tmp/dela-tools-test';
/** 工具传进来的形态：Windows 上 resolve 会把 POSIX 绝对路径挂到当前盘。 */
const mangled = (path: string) => resolveLocal(path);

describe('远程工具（真机）', () => {
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
    const result = await run('pwd; echo "home=$HOME"; echo 出错了 >&2');
    expect(result.output.split('\n')[0]).toBe(root);
    // 登录 shell：HOME 是远端用户自己的主目录。
    expect(result.output).toMatch(/home=\//);
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

  it('POSIX 文件名里的反斜杠不会变成目录分隔符', async () => {
    const path = `${root}/字\\面.txt`;
    await ops.write.writeFile(path, 'literal backslash\n');
    expect((await run(`test -f ${shellQuote(path)}`)).exitCode).toBe(0);
    expect((await ops.read.readFile(path)).toString()).toBe('literal backslash\n');
  });

  it('识别图片 MIME（按扩展名，不多跑一次远端请求）', async () => {
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

  it('bash 超时映射成 Pi 认的 timeout 前缀', async () => {
    await expect(ops.bash.exec('sleep 30', root, { onData: () => {}, timeout: 1 })).rejects.toThrow(
      'timeout:1',
    );
  }, 60_000);

  it('大输出完整流回，不被任务缓冲截断（缓冲只兜住断线期间）', async () => {
    let bytes = 0;
    const result = await ops.bash.exec('head -c 12000000 /dev/zero | base64 -w0', root, {
      onData: (chunk) => {
        bytes += chunk.length;
      },
    });
    expect(result.exitCode).toBe(0);
    expect(bytes).toBe(16_000_000);
  }, 120_000);

  it('预览用的 stat 与片段读取：只拉请求的那一段', async () => {
    // 预览大文件靠这两个入口：stat 从目录清单拿 size/mtime，片段读取只回一段。
    await ops.write.writeFile(`${root}/slice.txt`, '0123456789');
    const stat = await statRemoteFile(target, `${root}/slice.txt`);
    expect(stat).toMatchObject({ directory: false, size: 10 });
    expect(stat.modifiedAt).toBeGreaterThan(0);
    await expect(statRemoteFile(target, root)).rejects.toThrow('这是目录');
    await expect(statRemoteFile(target, `${root}/nope.txt`)).rejects.toThrow('远端文件不存在');

    expect((await readRemoteRange(target, `${root}/slice.txt`, 0, 4)).toString()).toBe('0123');
    expect((await readRemoteRange(target, `${root}/slice.txt`, 8, 2)).toString()).toBe('89');
    // 只回一段：整体长度不是文件的全部长度（整篇进内存就是在这里失守的）。
    expect((await readRemoteRange(target, `${root}/slice.txt`, 2, 3)).length).toBe(3);
  }, 120_000);

  it('目录清单按远端原样返回，顺带把变化通知发出去', async () => {
    // 目录树走的就是这个入口：清单内容与远端 ls 一致。
    const seen: string[] = [];
    const stop = onRemoteChange((path) => seen.push(path));
    try {
      const entries = await listRemoteDirectory(target, root);
      const ls = await exec(target, `ls -A1 ${shellQuote(root)}`);
      expect(entries.map((entry) => entry.name).sort()).toEqual(
        ls.stdout.toString().split('\n').filter(Boolean).sort(),
      );
      await ops.write.writeFile(`${root}/notify.txt`, 'notify\n');
      expect(seen).toContain(root);
      await ops.bash.exec('echo shell', root, { onData: () => {} });
      expect(seen.filter((path) => path === root).length).toBeGreaterThan(1);
    } finally {
      stop();
    }
  }, 120_000);
});
