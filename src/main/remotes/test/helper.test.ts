// helper 通道回归：默认在 CI 里跳过，设 DELA_REMOTE_HOST 后才真连远端。
// 需要真机才能验证的是上传校验、启动、隧道、握手与进程组取消，这些都无法用假 ssh 覆盖。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { createConnection } from 'node:net';
import { exec, locateSsh, type RemoteTarget } from '../transport';
import {
  HELPER_VERSION,
  closeHelper,
  helperArtifact,
  helperRemoteDir,
  helperSession,
  tunnelArguments,
} from '../helper';

const host = process.env.DELA_REMOTE_HOST;
const target: RemoteTarget = {
  host: host ?? 'root@127.0.0.1',
  keyPath: process.env.DELA_REMOTE_KEY ?? null,
};
const live = describe.skipIf(!host);

/** 本地隧道端口还在不在听：用来判断 closeHelper 是否真的把隧道收掉了。 */
function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe('helper 约定', () => {
  it('按架构找本地产物', () => {
    expect(helperArtifact('amd64')).toMatch(/dela-helper-linux-amd64$/);
    expect(helperArtifact('riscv64')).toBeNull();
  });

  it('远端目录按版本与 sha8 分家', () => {
    expect(helperRemoteDir('0123456789abcdef')).toBe(
      `$HOME/.dela/helper/${HELPER_VERSION}-01234567`,
    );
  });

  it('隧道参数与命令参数同源，只多 -L 与 -N', () => {
    const args = tunnelArguments(target, 5000, 6000);
    expect(args).toContain('-N');
    expect(args).toContain('127.0.0.1:5000:127.0.0.1:6000');
    expect(args).toContain('BatchMode=yes');
    expect(args.at(-1)).toBe(target.host);
  });
});

live('helper 通道（需要 DELA_REMOTE_HOST）', () => {
  it('上传、启动、隧道、握手一次走通', async () => {
    const session = await helperSession(target);
    expect(session).not.toBeNull();
    expect(session!.port).toBeGreaterThan(0);
    // 远端跑的是不是本地产物：目录名里的 sha8 与本地文件一致，说明上传校验真的生效。
    const artifact = helperArtifact('amd64')!;
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex');
    const check = await exec(
      target,
      `sha256sum $HOME/.dela/helper/${HELPER_VERSION}-${digest.slice(0, 8)}/dela-helper | cut -d' ' -f1`,
    );
    expect(check.stdout.toString().trim()).toBe(digest);
  }, 180_000);

  it('二进制读写往返一致', async () => {
    const session = await helperSession(target);
    const body = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));
    await session!.writeFile('/tmp/dela-helper-roundtrip.bin', body);
    const back = await session!.readFile('/tmp/dela-helper-roundtrip.bin');
    expect(back.equals(body)).toBe(true);
    await exec(target, 'rm -f /tmp/dela-helper-roundtrip.bin');
  }, 60_000);

  it('执行命令拿到退出码、工作目录与注入的环境变量', async () => {
    const session = await helperSession(target);
    const chunks: Buffer[] = [];
    const result = await session!.exec('pwd; echo "v=$PI_TEST"; echo err >&2; exit 5', {
      cwd: '/root',
      env: { PI_TEST: 'hello' },
      onData: (chunk) => chunks.push(chunk),
    });
    expect(result.code).toBe(5);
    expect(result.state).toBe('exited');
    const text = Buffer.concat(chunks).toString();
    expect(text).toContain('/root');
    expect(text).toContain('v=hello');
  }, 60_000);

  it('超时由 helper 判定，进程组不留残余', async () => {
    const session = await helperSession(target);
    const result = await session!.exec('sleep 987', { cwd: '/root', timeoutMs: 1000 });
    expect(result.state).toBe('timeout');
    const leftover = await exec(target, 'pgrep -f "[s]leep 987" | wc -l');
    expect(leftover.stdout.toString().trim()).toBe('0');
  }, 60_000);

  it('取消任务会终止远端进程组', async () => {
    const session = await helperSession(target);
    const controller = new AbortController();
    const running = session!.exec('sleep 986 & sleep 986 & wait', {
      cwd: '/root',
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    controller.abort();
    await expect(running).rejects.toThrow('aborted');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const leftover = await exec(target, 'pgrep -f "[s]leep 986" | wc -l');
    expect(leftover.stdout.toString().trim()).toBe('0');
  }, 60_000);

  it('放掉通道只关本地隧道，远端 helper 交给空闲自退', async () => {
    const session = await helperSession(target);
    const port = session!.port;
    expect(await portAccepts(port)).toBe(true);
    await closeHelper();
    // Dela 不发退出请求，所以这里能断言的是本地隧道确实断了；
    // 远端进程何时消失由 helper 自己的空闲超时决定（实现里用 5 秒实例实测过）。
    let open = true;
    for (let attempt = 0; attempt < 20 && open; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      open = await portAccepts(port);
    }
    expect(open).toBe(false);
  }, 60_000);

  it('关闭后能重新建立通道', async () => {
    const session = await helperSession(target);
    expect(session).not.toBeNull();
    expect(locateSsh()).toMatch(/ssh\.exe$/i);
    await closeHelper();
  }, 180_000);
});
