// helper 通道真机回归：需要 DELA_REMOTE_HOST（如 root@1.2.3.4），由 pnpm test:remote 运行，
// 不在默认 pnpm test 与 CI 里。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { exec, type RemoteTarget } from '../transport';
import {
  HELPER_VERSION,
  closeHelper,
  helperArtifact,
  helperSession,
  readyHelper,
  type WatchEvent,
} from '../helper';

const target: RemoteTarget = {
  host: process.env.DELA_REMOTE_HOST!,
  keyPath: process.env.DELA_REMOTE_KEY ?? null,
};

const digest = createHash('sha256')
  .update(readFileSync(helperArtifact('amd64')!))
  .digest('hex');
const remoteDir = `$HOME/.dela/helper/${HELPER_VERSION}-${digest.slice(0, 8)}`;

/** 远端 run.json 里的 pid：复用与重起要靠它分辨是不是同一个实例。 */
async function helperPid(): Promise<string> {
  const result = await exec(
    target,
    `sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p' ${remoteDir}/run.json 2>/dev/null`,
  );
  return result.stdout.toString().trim();
}

/** 杀掉本机到远端的隧道（只杀 -L 那一条 ssh，不碰远端 helper）。 */
async function killLocalTunnels(): Promise<void> {
  const { execSync } = await import('node:child_process');
  if (process.platform === 'win32')
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='ssh.exe'\\" | Where-Object { $_.CommandLine -match ' -N -L ' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
    );
  else execSync(`pkill -f -- "ssh .* -N -L 127.0.0.1:" || true`);
}

describe('helper 通道（真机）', () => {
  it('上传、启动、隧道、握手一次走通，远端产物与本地一致', async () => {
    await readyHelper(target);
    const check = await exec(target, `sha256sum ${remoteDir}/dela-helper | cut -d' ' -f1`);
    expect(check.stdout.toString().trim()).toBe(digest);
  }, 180_000);

  it('二进制读写往返一致，写入时自动建父目录', async () => {
    const session = helperSession(target);
    const body = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));
    await session.writeFile('/tmp/dela-helper-test/deep/roundtrip.bin', body);
    expect((await session.readFile('/tmp/dela-helper-test/deep/roundtrip.bin')).equals(body)).toBe(
      true,
    );
    await exec(target, 'rm -rf /tmp/dela-helper-test');
  }, 60_000);

  it('执行命令拿到退出码、工作目录与注入的环境变量', async () => {
    const chunks: Buffer[] = [];
    const result = await helperSession(target).exec(
      'pwd; echo "v=$PI_TEST"; echo err >&2; exit 5',
      { cwd: '/tmp', env: { PI_TEST: 'hello' }, onData: (chunk) => chunks.push(chunk) },
    );
    expect(result).toEqual({ code: 5, state: 'exited', lost: 0 });
    const text = Buffer.concat(chunks).toString();
    expect(text).toContain('/tmp');
    expect(text).toContain('v=hello');
    expect(text).toContain('err');
  }, 60_000);

  it('超时由 helper 判定，进程组不留残余', async () => {
    const result = await helperSession(target).exec('sleep 987', { cwd: '/tmp', timeoutMs: 1000 });
    expect(result.state).toBe('timeout');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const leftover = await exec(target, 'pgrep -f "[s]leep 987" | wc -l');
    expect(leftover.stdout.toString().trim()).toBe('0');
  }, 60_000);

  it('取消任务会终止远端进程组', async () => {
    const controller = new AbortController();
    const running = helperSession(target).exec('sleep 986 & sleep 986 & wait', {
      cwd: '/tmp',
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    controller.abort();
    await expect(running).rejects.toThrow('aborted');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const leftover = await exec(target, 'pgrep -f "[s]leep 986" | wc -l');
    expect(leftover.stdout.toString().trim()).toBe('0');
  }, 60_000);

  // 这是这一版的核心承诺：网络断了，远端在跑的命令不被杀，重连后输出与退出码都接得回来。
  it('隧道在命令中途断开：命令继续跑，重连后输出与退出码完整接回', async () => {
    const chunks: Buffer[] = [];
    const running = helperSession(target).exec(
      'for i in 1 2 3 4 5 6; do echo "line $i"; sleep 1; done; exit 3',
      { cwd: '/tmp', onData: (chunk) => chunks.push(chunk) },
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const pidBefore = await helperPid();
    await killLocalTunnels();
    const result = await running;
    const text = Buffer.concat(chunks).toString();
    expect(result).toEqual({ code: 3, state: 'exited', lost: 0 });
    expect(text.match(/line \d/g)).toEqual([1, 2, 3, 4, 5, 6].map((i) => `line ${i}`));
    // 重连复用的是同一个远端实例，不是新起的。
    expect(await helperPid()).toBe(pidBefore);
  }, 120_000);

  it('Dela 关掉通道再连回来：复用同一个远端实例', async () => {
    await readyHelper(target);
    const pidBefore = await helperPid();
    closeHelper();
    await readyHelper(target);
    expect(await helperPid()).toBe(pidBefore);
  }, 120_000);

  it('远端 helper 被杀：通道自动重起一个新实例，调用照常成功', async () => {
    await readyHelper(target);
    const pidBefore = await helperPid();
    await exec(target, `kill ${pidBefore}; sleep 0.5`);
    expect((await helperSession(target).list('/etc')).length).toBeGreaterThan(0);
    const pidAfter = await helperPid();
    expect(pidAfter).not.toBe('');
    expect(pidAfter).not.toBe(pidBefore);
  }, 180_000);

  it('glob 与 search 在远端仓库上给出结构化结果', async () => {
    const session = helperSession(target);
    const dir = '/tmp/dela-search-test';
    await session.writeFile(`${dir}/src/a.ts`, 'const alpha = 1;\nconst beta = 2;\n');
    await session.writeFile(`${dir}/name:colon.txt`, 'alpha\n');
    expect((await session.glob(dir, '*.ts', 100)).files).toEqual(['src/a.ts']);
    const found = await session.search({ path: dir, pattern: 'alpha', limit: 10 });
    expect(found.matches.map((match) => `${match.path}:${match.line}`).sort()).toEqual([
      'name:colon.txt:1',
      'src/a.ts:1',
    ]);
    const missing = await session.stat([`${dir}/src/a.ts`, `${dir}/nope`]);
    expect(missing.map((item) => [item.exists, item.readable])).toEqual([
      [true, true],
      [false, false],
    ]);
    await exec(target, `rm -rf ${dir}`);
  }, 60_000);

  it('watch：远端自己改的目录会推事件，撤销后不再推', async () => {
    const session = helperSession(target);
    const dir = '/tmp/dela-watch-test';
    await exec(target, `rm -rf ${dir} && mkdir -p ${dir}`);
    const events: WatchEvent[] = [];
    const controller = new AbortController();
    const stream = session.watchEvents((event) => events.push(event), controller.signal);
    /** 等到出现「新」事件为止。只看新增：合并窗口会晚几百毫秒才推，之前的事件不能算数。 */
    const waitNew = async (label: string, from: number) => {
      for (let i = 0; i < 60 && events.length <= from; i += 1)
        await new Promise((r) => setTimeout(r, 100));
      expect(events.length, `${label}（收到 ${JSON.stringify(events)}）`).toBeGreaterThan(from);
    };

    expect((await session.setWatch('watch-test', [dir])).watching).toBe(1);
    // 关键：这条 ssh 完全不经过 Dela 的工具路径——watch 就是要覆盖它。
    let mark = events.length;
    await exec(target, `touch ${dir}/outside.txt`);
    await waitNew('远端自己在被监视目录里建文件后应有 change', mark);
    expect(
      events.slice(mark).some((event) => event.type === 'change' && event.paths.includes(dir)),
    ).toBe(true);

    await session.clearWatch('watch-test');
    mark = events.length;
    await exec(target, `touch ${dir}/after-unwatch.txt`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(events.length).toBe(mark);

    controller.abort();
    await stream.catch(() => {});
    await exec(target, `rm -rf ${dir}`);
  }, 120_000);

  it('端口发现：远端自己起的监听进程会出现在清单里，进程结束就消失', async () => {
    const session = helperSession(target);
    const port = 18377;
    const controller = new AbortController();
    const task = session.exec(`python3 -m http.server ${port} --bind 127.0.0.1`, {
      cwd: '/tmp',
      signal: controller.signal,
    });
    try {
      let found: { port: number; process?: string } | undefined;
      for (let i = 0; i < 50 && !found; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        found = (await session.listPorts()).find((entry) => entry.port === port);
      }
      expect(found, '远端 python3 起的端口应出现在清单里').toBeTruthy();
      expect(found!.process).toBe('python3');

      controller.abort();
      await task.catch(() => {});
      let gone = false;
      for (let i = 0; i < 50 && !gone; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        gone = !(await session.listPorts()).some((entry) => entry.port === port);
      }
      expect(gone, '进程退出后端口应从清单里消失').toBe(true);
    } finally {
      controller.abort();
      await task.catch(() => {});
    }
  }, 60_000);
});
