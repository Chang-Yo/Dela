// 远端文件传输真机回归：字节级往返与「用系统默认程序打开」的临时文件清理。
// 需要 DELA_REMOTE_HOST（如 root@1.2.3.4），由 pnpm test:remote 运行，不在默认 pnpm test 与 CI 里。
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
  },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
}));

import { closeRemoteOpens, downloadRemoteFile, openRemoteFile, uploadLocalFile } from '../transfer';
import { readRemoteRange, statRemoteFile } from '../operations';
import type { RemoteTarget } from '../transport';

const target: RemoteTarget = {
  host: process.env.DELA_REMOTE_HOST!,
  keyPath: process.env.DELA_REMOTE_KEY ?? null,
};
const root = '/tmp/dela-transfer-test';
const local = mkdtempSync(join(tmpdir(), 'dela-transfer-'));

afterAll(() => rmSync(local, { recursive: true, force: true }));

describe('远端文件传输（真机）', () => {
  it('二进制上传与下载：字节逐个相同，大小与 sha256 都对得上', async () => {
    // 3 MB 多一点的随机字节：跨过 1 MB 的分块边界，且带 NUL/非 UTF-8（文本通道会在这里变形）。
    const payload = Buffer.concat([randomBytes(3 * 1024 * 1024 + 7), Buffer.from([0, 255, 10])]);
    const source = join(local, 'bin.dat');
    writeFileSync(source, payload);
    const digest = createHash('sha256').update(payload).digest('hex');

    const remotePath = await uploadLocalFile(target, source, root);
    expect(remotePath).toBe(`${root}/bin.dat`);
    const stat = await statRemoteFile(target, remotePath);
    expect(stat.size).toBe(payload.length);

    const back = join(local, 'back.dat');
    await downloadRemoteFile(target, remotePath, back);
    const restored = readFileSync(back);
    expect(restored.length).toBe(payload.length);
    expect(createHash('sha256').update(restored).digest('hex')).toBe(digest);

    // 分块读的边界：最后一块不能越界，offset 到文件尾也要能收尾。
    const tail = await readRemoteRange(target, remotePath, payload.length - 3, 3);
    expect([...tail]).toEqual([0, 255, 10]);
    expect((await readRemoteRange(target, remotePath, 0, 10)).length).toBe(10);
  }, 180_000);

  it('用系统默认程序打开：先下到临时目录，退出清理（shell 在这里是替身，不真开程序）', async () => {
    const source = join(local, 'open.txt');
    writeFileSync(source, '打开我\n');
    const remotePath = await uploadLocalFile(target, source, root);

    await openRemoteFile(target, remotePath);
    const { openPath } = await import('electron').then((m) => m.shell);
    const opened = vi.mocked(openPath).mock.calls.at(-1)?.[0] ?? '';
    // 命名是「连接 + 路径的哈希前缀 + 原名」：同名文件在临时目录里不会互相覆盖。
    expect(opened).toContain(join('dela-remote-open', ''));
    expect(opened.endsWith('-open.txt')).toBe(true);
    expect(readFileSync(opened, 'utf8')).toBe('打开我\n');

    await closeRemoteOpens();
    expect(existsSync(opened)).toBe(false);
  }, 180_000);
});
