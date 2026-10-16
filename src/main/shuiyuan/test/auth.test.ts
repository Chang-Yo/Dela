import { constants, publicEncrypt } from 'node:crypto';
import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface AuthWindow {
  url: string;
  destroyed: boolean;
  minimized: boolean;
  close(): void;
  focus: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
}
const mock = vi.hoisted(() => ({
  windows: [] as AuthWindow[],
  load: vi.fn<() => Promise<void>>(),
  save: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('../../campus', () => ({
  getCampusSession: async () => undefined,
  createCampusLoginWindow: () => {
    let closed: (() => void) | undefined;
    const window = {
      url: '',
      destroyed: false,
      minimized: false,
      on: (_event: string, callback: () => void) => {
        closed = callback;
      },
      loadURL: async (url: string) => {
        window.url = url;
        await mock.load();
      },
      isDestroyed: () => window.destroyed,
      isMinimized: () => window.minimized,
      restore: vi.fn(() => {
        window.minimized = false;
      }),
      show: vi.fn(),
      focus: vi.fn(),
      close: () => {
        if (!window.destroyed) {
          window.destroyed = true;
          closed?.();
        }
      },
    };
    mock.windows.push(window);
    return window;
  },
}));
vi.mock('../../credentials', () => ({
  loadShuiyuanCredential: () => null,
  saveShuiyuanCredential: mock.save,
  clearShuiyuanCredential: vi.fn(),
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
import { bindShuiyuan, startShuiyuanAuth, unbindShuiyuan } from '../api';

const sender = { id: 1 } as WebContents;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function payload(window: AuthWindow, nonce?: string) {
  const params = new URL(window.url).searchParams;
  return publicEncrypt(
    { key: params.get('public_key')!, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(JSON.stringify({ key: 'synthetic-key', nonce: nonce ?? params.get('nonce') })),
  ).toString('base64');
}
beforeEach(async () => {
  await unbindShuiyuan();
  mock.windows = [];
  mock.save.mockReset();
  mock.load.mockReset().mockResolvedValue(undefined);
  mock.fetch
    .mockReset()
    .mockResolvedValue(new Response(JSON.stringify({ current_user: { username: 'fixture' } })));
  vi.stubGlobal('fetch', mock.fetch);
});
afterEach(async () => {
  await unbindShuiyuan();
  vi.unstubAllGlobals();
});

describe('水源授权窗口生命周期', () => {
  it('连续发起复用窗口和密钥，最小化后恢复；关窗后原密文仍能绑定', async () => {
    let loaded!: () => void;
    mock.load.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        loaded = resolve;
      }),
    );
    const first = startShuiyuanAuth(sender);
    await flush();
    const window = mock.windows[0]!;
    const encrypted = payload(window);
    window.minimized = true;
    await startShuiyuanAuth(sender);
    expect(mock.windows).toHaveLength(1);
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    loaded();
    await first;
    window.close();
    await expect(bindShuiyuan(encrypted)).resolves.toMatchObject({
      connected: true,
      username: 'fixture',
    });
    expect(mock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'synthetic-key',
        clientId: new URL(window.url).searchParams.get('client_id'),
      }),
    );
  });

  it('窗口仍开着时绑定成功会关闭，随后可以重新发起', async () => {
    await startShuiyuanAuth(sender);
    const first = mock.windows[0]!;
    await bindShuiyuan(payload(first));
    expect(first.destroyed).toBe(true);
    await expect(bindShuiyuan(payload(first))).rejects.toThrow('请先点击');
    await startShuiyuanAuth(sender);
    expect(mock.windows).toHaveLength(2);
  });

  it('加载失败清理窗口和待绑定状态，重试可成功', async () => {
    mock.load.mockRejectedValueOnce(new Error('offline'));
    await expect(startShuiyuanAuth(sender)).rejects.toThrow('offline');
    expect(mock.windows[0]!.destroyed).toBe(true);
    await expect(bindShuiyuan(payload(mock.windows[0]!))).rejects.toThrow('请先点击');
    await startShuiyuanAuth(sender);
    await expect(bindShuiyuan(payload(mock.windows[1]!))).resolves.toMatchObject({
      connected: true,
    });
  });

  it('加载途中用户关窗时不把取消报告成页面加载故障', async () => {
    let fail!: (error: Error) => void;
    mock.load.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    );
    const started = startShuiyuanAuth(sender);
    await flush();
    mock.windows[0]!.close();
    fail(new Error('ERR_ABORTED'));
    await expect(started).resolves.toBeUndefined();
    await startShuiyuanAuth(sender);
    expect(mock.windows).toHaveLength(2);
  });

  it('校验失败保留本次授权，能够重试绑定', async () => {
    await startShuiyuanAuth(sender);
    const window = mock.windows[0]!;
    await expect(bindShuiyuan(payload(window, 'wrong-nonce'))).rejects.toThrow('不匹配');
    expect(mock.fetch).not.toHaveBeenCalled();
    mock.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(bindShuiyuan(payload(window))).rejects.toThrow('无法连接');
    expect(window.destroyed).toBe(false);
    await expect(bindShuiyuan(payload(window))).resolves.toMatchObject({ connected: true });
  });

  it('旧绑定请求完成不会清空或关闭后来新开的授权', async () => {
    await startShuiyuanAuth(sender);
    const first = mock.windows[0]!;
    let verified!: (value: Response) => void;
    mock.fetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        verified = resolve;
      }),
    );
    const binding = bindShuiyuan(payload(first));
    first.close();
    await startShuiyuanAuth(sender);
    const second = mock.windows[1]!;
    verified(new Response(JSON.stringify({ current_user: { username: 'fixture' } })));
    await binding;
    expect(second.destroyed).toBe(false);
    await expect(bindShuiyuan(payload(second))).resolves.toMatchObject({ connected: true });
  });
});
