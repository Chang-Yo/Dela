// helper 通道的离线部分：产物查找与会话身份核对；上传、隧道、握手、重建等
// 需真机的部分在 helper.remote.test.ts，由 pnpm test:remote 运行。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { helperArtifact, sessionFor, type HelperSession } from '../helper';

describe('helper 约定', () => {
  it('按架构找本地产物', () => {
    expect(helperArtifact('amd64')).toMatch(/dela-helper-linux-amd64$/);
    expect(helperArtifact('riscv64')).toBeNull();
  });
});

// 每个连接一条通道（多通道）。交回会话前的身份核对是最后一道闸：拿到了别的连接的会话就等于
// 在另一台服务器上跑命令、写文件。
describe('会话身份核对', () => {
  // 核对只看引用，不需要真会话。
  const session = {} as HelperSession;

  it('目标不一致就不交出会话', () => {
    expect(sessionFor({ key: 'user@a|', session }, 'user@a|')).toBe(session);
    expect(sessionFor({ key: 'user@a|', session }, 'user@b|')).toBeNull();
    expect(sessionFor(null, 'user@a|')).toBeNull();
  });
});
