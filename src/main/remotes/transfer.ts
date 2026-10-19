/**
 * 远端文件二进制传输：下载分块写 .part 再改名，上传整篇读入（helper 侧临时文件 + rename），
 * 两条路失败都不留半个文件；「用系统默认程序打开」下载到临时目录，退出时清理。
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { once } from 'node:events';
import { app, shell } from 'electron';
import { remoteJoin } from './api';
import { readRemoteRange, statRemoteFile, writeRemoteFile } from './operations';
import type { RemoteTarget } from './transport';

/** 一次拉回的字节数：与预览协议同量级，避免单次请求过大把通道占满。 */
const chunkSize = 1024 * 1024;

export async function downloadRemoteFile(
  target: RemoteTarget,
  remotePath: string,
  localPath: string,
): Promise<void> {
  const entry = await statRemoteFile(target, remotePath);
  const size = entry.size ?? 0;
  // 临时名带 pid：同名并发下载不会互相踩。写完再 rename，失败不留半个文件。
  const temp = `${localPath}.${process.pid}.part`;
  const stream = createWriteStream(temp);
  try {
    for (let offset = 0; offset < size; offset += chunkSize) {
      const chunk = await readRemoteRange(
        target,
        remotePath,
        offset,
        Math.min(chunkSize, size - offset),
      );
      if (!chunk.length) break;
      if (!stream.write(chunk)) await once(stream, 'drain');
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    await rename(temp, localPath);
  } catch (error) {
    stream.destroy();
    await rm(temp, { force: true });
    throw error;
  }
}

export async function uploadLocalFile(
  target: RemoteTarget,
  localPath: string,
  remoteDirectory: string,
): Promise<string> {
  const remotePath = remoteJoin(remoteDirectory, basename(localPath));
  await writeRemoteFile(target, remotePath, await readFile(localPath));
  return remotePath;
}

const openedFiles = new Set<string>();

/** 下载到临时目录再交给系统默认程序；按连接 + 路径哈希命名，避免同名互踩。 */
export async function openRemoteFile(target: RemoteTarget, remotePath: string): Promise<void> {
  const directory = join(app.getPath('temp'), 'dela-remote-open');
  await mkdir(directory, { recursive: true });
  const key = createHash('sha256')
    .update(`${target.host}:${remotePath}`)
    .digest('hex')
    .slice(0, 16);
  const local = join(directory, `${key}-${basename(remotePath)}`);
  await downloadRemoteFile(target, remotePath, local);
  openedFiles.add(local);
  const error = await shell.openPath(local);
  if (error) throw new Error(`无法用系统默认程序打开：${error}`);
}

export async function closeRemoteOpens(): Promise<void> {
  const paths = [...openedFiles];
  openedFiles.clear();
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => {})));
}
