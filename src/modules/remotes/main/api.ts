// 私钥路径随连接保存，真正的凭据始终由 ssh 从 ~/.ssh 与 agent 读取，Dela 不落任何密码。
import { randomUUID } from 'node:crypto';
import { hostPorts } from '../../../core/ports';
import type {
  RemoteBrowseResult,
  RemoteConnection,
  RemoteDraft,
  RemotePrepare,
  RemoteProbe,
  RemoteSetupProgress,
  SshConfigHost,
} from '../contract';
import { remoteDraftSchema, withinRemotePath } from '../contract';
import { prepareHelper } from '../../../core/remote/helper';
import { locateRemote, makeRemoteDirectory } from '../../../core/remote/operations';
import { sshConfigHosts } from './ssh-config';
import { probeRemote, type RemoteTarget } from '../../../core/remote/transport';

interface RemoteRow {
  id: string;
  label: string;
  host: string;
  port: number | null;
  key_path: string | null;
  created_at: string;
}

const fromRow = (row: RemoteRow): RemoteConnection => ({
  id: row.id,
  label: row.label,
  host: row.host,
  port: row.port,
  keyPath: row.key_path,
  createdAt: row.created_at,
});

export function listRemotes(): RemoteConnection[] {
  const rows = hostPorts()
    .database()
    .prepare('SELECT * FROM remotes ORDER BY created_at')
    .all() as RemoteRow[];
  return rows.map(fromRow);
}

export function remoteById(id: string): RemoteConnection {
  const row = hostPorts().database().prepare('SELECT * FROM remotes WHERE id=?').get(id) as
    RemoteRow | undefined;
  if (!row) throw new Error('远程连接不存在');
  return fromRow(row);
}

export function targetOf(draft: RemoteDraft): RemoteTarget {
  return { host: draft.host, port: draft.port ?? null, keyPath: draft.keyPath ?? null };
}

export function saveRemote(draft: RemoteDraft & { id?: string | null }): RemoteConnection {
  const parsed = remoteDraftSchema.parse(draft);
  const label = parsed.label?.trim() || parsed.host;
  const database = hostPorts().database();
  if (draft.id) {
    remoteById(draft.id);
    database
      .prepare('UPDATE remotes SET label=?, host=?, port=?, key_path=? WHERE id=?')
      .run(label, parsed.host, parsed.port ?? null, parsed.keyPath ?? null, draft.id);
    return remoteById(draft.id);
  }
  const id = randomUUID();
  database
    .prepare(
      'INSERT INTO remotes (id, label, host, port, key_path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      label,
      parsed.host,
      parsed.port ?? null,
      parsed.keyPath ?? null,
      new Date().toISOString(),
    );
  return remoteById(id);
}

/** 删除连接连同名下项目按「移除项目」语义带走（会话删、远端目录留）；动态导入避开模块环。 */
export async function removeRemote(id: string): Promise<void> {
  remoteById(id);
  const projects = hostPorts()
    .database()
    .prepare(`SELECT id FROM workspace_entries WHERE remote_id=? AND kind='project'`)
    .all(id) as { id: string }[];
  if (projects.length) {
    const { removeWorkspaceEntry } = await import('../../workspace');
    for (const project of projects) await removeWorkspaceEntry(project.id);
  }
  hostPorts().database().prepare('DELETE FROM remotes WHERE id=?').run(id);
}

export function configHostCandidates(): SshConfigHost[] {
  const saved = new Set(listRemotes().map((connection) => connection.host));
  return sshConfigHosts().filter((host) => !saved.has(host.alias));
}

export async function probeConnection(draft: RemoteDraft): Promise<RemoteProbe> {
  const parsed = remoteDraftSchema.parse(draft);
  try {
    const probe = await probeRemote(targetOf(parsed));
    return { ok: true, message: `${probe.hostname} · ${probe.system} ${probe.machine}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 远程项目的全部能力都经 helper，它起不来这台服务器就不能用；SSH 不通由引导的探测步报出。 */
export async function prepareRemote(
  draft: RemoteDraft,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<RemotePrepare> {
  const parsed = remoteDraftSchema.parse(draft);
  const { ok, failure, home } = await prepareHelper(targetOf(parsed), onProgress);
  if (!ok) return { ok: false, message: failure ?? '未知原因', home: null };
  onProgress?.({ step: 'ready', ok: true, detail: 'helper 通道已就绪' });
  return { ok: true, message: '', home };
}

export async function createRemoteDirectory(
  draft: RemoteDraft,
  parent: string,
  name: string,
): Promise<string> {
  const path = remoteJoin(parent.replace(/\/+$/, '') || '/', name);
  await makeRemoteDirectory(targetOf(remoteDraftSchema.parse(draft)), path);
  return path;
}

export function parentOf(path: string): string | null {
  const trimmed = path.replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return null;
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? '/' : trimmed.slice(0, cut);
}

/** 远端路径拼接：项目根就是 `/` 时不能拼出 `//name`。 */
export function remoteJoin(directory: string, name: string): string {
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`;
}

/** 目标路径是否就是项目根或在其之内；同为根时一律放行。渲染端构造地址时用同一份判断。 */
export const withinRemoteRoot = withinRemotePath;

export async function browseRemote(draft: RemoteDraft, path: string): Promise<RemoteBrowseResult> {
  const target = targetOf(remoteDraftSchema.parse(draft));
  const wanted = path.replace(/\/+$/, '') || '/';
  const location = await locateRemote(target, wanted);
  if (location.kind !== 'directory')
    throw new Error(`${wanted} 不是目录：请选择一个远端目录作为项目位置`);
  const directories = (location.entries ?? [])
    .filter((entry) => entry.directory)
    .map((entry) => ({
      name: entry.name,
      path: remoteJoin(wanted, entry.name),
      directory: true,
      size: null,
      modifiedAt: entry.modifiedAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return { path: wanted, parent: parentOf(wanted), directories };
}
