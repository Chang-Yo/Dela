// 下载分块写 .part 再改名，上传经 helper 侧临时文件 + rename，失败都不留半个文件。
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { once } from 'node:events';
import { app, shell } from 'electron';
import { remoteJoin } from './api';
import { readRemoteRange, statRemoteFile, writeRemoteFile } from '../../../core/remote/operations';
import type { RemoteTarget } from '../../../core/remote/transport';

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
