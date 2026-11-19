// 传输层的离线部分：命令拼装用的引号处理。
// 需要真实主机才能验证的部分（自检、NUL 清单解析、二进制写入往返）在
// transport.remote.test.ts，由 pnpm test:remote 运行。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { shellQuote } from '../transport';

describe('shellQuote', () => {
  it('包裹单引号并转义内部单引号', () => {
    expect(shellQuote('/root/a b')).toBe("'/root/a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
