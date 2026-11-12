// 会话内文件的定位、打开与改动审阅入口。
import type { UncommittedChanges } from '../../../shared/api';
import { hostPorts } from '../../host';
import * as changes from '../changes';
import { resolveSessionFile } from '../session-path';
import { isRemoteSession, row, sessionCwd } from './store';

/** 会话内文件的定位/打开入口：相对路径按会话 cwd 解析；远程项目的文件不在本机。 */
function sessionFilePath(sessionId: string, rawPath: string): string {
  const meta = row(sessionId);
  if (isRemoteSession(meta)) throw new Error('远程项目的文件不在本机，请用远端方式打开');
  return resolveSessionFile(sessionCwd(meta.project_id, meta.cwd), rawPath);
}

export function revealSessionFile(sessionId: string, path: string): void {
  hostPorts().desktop.reveal(sessionFilePath(sessionId, path));
}

export async function openSessionFile(sessionId: string, path: string): Promise<void> {
  await hostPorts().desktop.open(sessionFilePath(sessionId, path));
}

/** 解析会话内文件的本机绝对路径（须真实存在）：应用内预览标签以它作为标签键。 */
export function locateSessionFile(sessionId: string, path: string): string {
  return sessionFilePath(sessionId, path);
}

export function listSessionTurnChanges(id: string) {
  row(id);
  return changes.listTurnChanges(id);
}

export function readSessionTurnChanges(id: string, turnId: string, includeStats = false) {
  row(id);
  return changes.readTurnChanges(id, turnId, includeStats);
}

export function readSessionTurnFileChange(id: string, turnId: string, path: string) {
  row(id);
  return changes.readTurnFileChange(id, turnId, path);
}

export function readSessionUncommittedChanges(id: string) {
  const meta = row(id);
  const cwd = sessionCwd(meta.project_id, meta.cwd);
  if (isRemoteSession(meta))
    return Promise.resolve({
      available: false,
      reason: 'remote' as const,
      cwd,
      repositoryRoot: null,
      head: null,
      warnings: [],
      files: [],
    });
  return changes.readUncommittedChanges(cwd);
}

export function readSessionUncommittedFileChange(id: string, path: string) {
  const meta = row(id);
  if (isRemoteSession(meta)) throw new Error('远程项目暂不支持变更审阅');
  return changes.readUncommittedFileChange(sessionCwd(meta.project_id, meta.cwd), path);
}

/** 会话目录能否做未提交改动审阅：轻探测（两次 git 调用），供入口可见性判定。 */
export async function uncommittedAvailability(
  id: string,
): Promise<Pick<UncommittedChanges, 'available' | 'reason'>> {
  const meta = row(id);
  const cwd = sessionCwd(meta.project_id, meta.cwd);
  if (isRemoteSession(meta)) return { available: false, reason: 'remote' };
  return changes.probeUncommitted(cwd);
}
