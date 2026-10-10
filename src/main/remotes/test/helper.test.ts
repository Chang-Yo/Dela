// helper 通道的离线部分：产物查找、通道动作的串行闸门、会话身份核对。
// 需要真机才能验证的（上传校验、启动、隧道、握手与进程组取消）在 helper.remote.test.ts，
// 由 pnpm test:remote 运行。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { helperArtifact, runExclusive, sessionFor, type HelperSession } from '../helper';

describe('helper 约定', () => {
  it('按架构找本地产物', () => {
    expect(helperArtifact('amd64')).toMatch(/dela-helper-linux-amd64$/);
    expect(helperArtifact('riscv64')).toBeNull();
  });
});

// 「读 current → await → 写 current」必须是不可分割的一件事：请求 B 在等旧通道关掉的期间
// 被 C 插进来占住 current，B 就会拿到 C 的会话（那是另一台服务器）。
describe('通道闸门', () => {
  it('并发的通道动作不交错', async () => {
    const trace: string[] = [];
    const action = (name: string, delay: number) =>
      runExclusive(async () => {
        trace.push(`${name}:in`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        trace.push(`${name}:out`);
      });
    // 后一个即使更快，也只能等前一个整个出来。
    await Promise.all([action('a', 20), action('b', 1)]);
    expect(trace).toEqual(['a:in', 'a:out', 'b:in', 'b:out']);
  });

  it('动作失败不挡住后面的动作', async () => {
    await expect(
      runExclusive(async () => {
        throw new Error('探测失败');
      }),
    ).rejects.toThrow('探测失败');
    await expect(runExclusive(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('会话身份核对', () => {
  // 核对只看引用，不需要真会话。
  const session = {} as HelperSession;

  it('目标不一致就不交出会话', () => {
    expect(sessionFor({ key: 'user@a|', session }, 'user@a|')).toBe(session);
    expect(sessionFor({ key: 'user@a|', session }, 'user@b|')).toBeNull();
    expect(sessionFor(null, 'user@a|')).toBeNull();
  });
});
