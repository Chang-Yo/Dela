// helper 约定的离线部分：按架构找本地随包产物。
// 需要真机才能验证的（上传校验、启动、隧道、握手与进程组取消）在 helper.remote.test.ts，
// 由 pnpm test:remote 运行。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { helperArtifact } from '../helper';

describe('helper 约定', () => {
  it('按架构找本地产物', () => {
    expect(helperArtifact('amd64')).toMatch(/dela-helper-linux-amd64$/);
    expect(helperArtifact('riscv64')).toBeNull();
  });
});
