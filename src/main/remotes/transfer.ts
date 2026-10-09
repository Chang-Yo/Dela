/**
 * 远端文件的二进制传输：下载到本地、上传到远端、用系统默认程序打开。
 *
 * 方向不同、策略也不同：
 * - 下载按块拉（复用 helper 的片段读取），大文件不整篇进内存；本地先写 .part 再改名。
 * - 上传整篇读进内存后一次 PUT：helper 落盘是同目录临时文件 + rename，失败不留半个文件。
 * - 「用系统默认程序打开」= 下载到临时目录再交给 shell，退出时清掉这些临时文件。
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

/** 上传一个本地文件到远端目录，返回写好的远端路径。 */
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

/**
 * 用系统默认程序打开远端文件：下载到临时目录（按连接 + 路径哈希命名，避免同名互踩），
 * 再交给 shell.openPath。
 */
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

/** 退出时清掉为「系统默认程序打开」下载的临时文件。 */
export async function closeRemoteOpens(): Promise<void> {
  const paths = [...openedFiles];
  openedFiles.clear();
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => {})));
}
