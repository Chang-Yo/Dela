/**
 * 远程连接：单表 CRUD + 连接自检 + 目录选择器。私钥路径随连接保存（它不是密钥本身），
 * 真正的凭据始终由 ssh 自己从 ~/.ssh 与 agent 读取，Dela 不落任何密码。
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../database';
import type {
  RemoteBrowseResult,
  RemoteConnection,
  RemoteDraft,
  RemotePrepare,
  RemoteProbe,
  RemoteSetupProgress,
} from '../../shared/remotes';
import { withinRemotePath } from '../../shared/remotes';
import { prepareHelper } from './helper';
import { locateRemote } from './operations';
import { probeRemote, type RemoteTarget } from './transport';

const hostPattern = /^[A-Za-z0-9._@:[\]-]+$/;

export const remoteDraftSchema = z.object({
  label: z.string().trim().max(80).optional(),
  host: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => hostPattern.test(value) && !value.startsWith('-'), {
      message: '目的地只能是 ssh 别名或 user@host',
    }),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  keyPath: z.string().trim().max(4096).nullable().optional(),
});

export const remoteIdSchema = z.string().uuid();

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
  const rows = getDatabase()
    .prepare('SELECT * FROM remotes ORDER BY created_at')
    .all() as RemoteRow[];
  return rows.map(fromRow);
}

export function remoteById(id: string): RemoteConnection {
  const row = getDatabase().prepare('SELECT * FROM remotes WHERE id=?').get(id) as
    RemoteRow | undefined;
  if (!row) throw new Error('远程连接不存在');
  return fromRow(row);
}

/** 草稿与已存连接共用的传输参数：向导里未保存的连接也能直接测与浏览。 */
export function targetOf(draft: RemoteDraft): RemoteTarget {
  return { host: draft.host, port: draft.port ?? null, keyPath: draft.keyPath ?? null };
}

export function saveRemote(draft: RemoteDraft & { id?: string | null }): RemoteConnection {
  const parsed = remoteDraftSchema.parse(draft);
  const label = parsed.label?.trim() || parsed.host;
  const database = getDatabase();
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

/** 还有项目引用时不允许删除，避免项目变成指向不存在连接的悬空条目。 */
export function removeRemote(id: string): void {
  remoteById(id);
  const used = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM workspace_entries WHERE remote_id=?')
    .get(id) as { count: number };
  if (used.count > 0) throw new Error('该连接下还有项目，请先移除项目');
  getDatabase().prepare('DELETE FROM remotes WHERE id=?').run(id);
}

export async function probeConnection(draft: RemoteDraft): Promise<RemoteProbe> {
  const parsed = remoteDraftSchema.parse(draft);
  try {
    const probe = await probeRemote(targetOf(parsed));
    // 只回一行摘要：四个结构化字段没有任何消费方（界面要的就是这一行）。
    return { ok: true, message: `${probe.hostname} · ${probe.system} ${probe.machine}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 向导「连接」：先自检（与设置页「测试连接」同一条 probe 路径），再引导 helper。
 * 远程项目的全部能力都经 helper：它起不来，这台服务器就不能当远程项目用。
 */
export async function prepareRemote(
  draft: RemoteDraft,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<RemotePrepare> {
  const parsed = remoteDraftSchema.parse(draft);
  onProgress?.({ step: 'probe', detail: '正在检测 SSH 连接' });
  const probe = await probeConnection(parsed);
  onProgress?.({ step: 'probe', ok: probe.ok, detail: probe.message });
  if (!probe.ok) return { ok: false, message: probe.message };

  const { ok, failure } = await prepareHelper(targetOf(parsed), onProgress);
  if (!ok) {
    const message = `helper 无法在这台服务器上运行：${failure ?? '未知原因'}`;
    onProgress?.({ step: 'ready', ok: false, detail: message });
    return { ok: false, message };
  }
  onProgress?.({ step: 'ready', ok: true, detail: 'helper 通道已就绪' });
  return { ok: true, message: probe.message };
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

export async function browseRemote(
  draft: RemoteDraft,
  path: string | null,
): Promise<RemoteBrowseResult> {
  const parsed = remoteDraftSchema.parse(draft);
  const target = targetOf(parsed);
  // 只有从主目录起步时才知道 home；后续翻页由渲染端沿用首次结果。
  const home = path ? null : (await probeRemote(target)).home;
  const wanted = path ?? home!;
  const location = await locateRemote(target, wanted);
  if (location.kind !== 'directory')
    throw new Error(`${wanted} 不是目录：请选择一个远端目录作为项目位置`);
  const base = wanted.replace(/\/+$/, '');
  const directories = (location.entries ?? [])
    .filter((entry) => entry.directory)
    .map((entry) => ({
      name: entry.name,
      path: remoteJoin(base, entry.name),
      directory: true,
      size: null,
      modifiedAt: entry.modifiedAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return { path: wanted, parent: parentOf(wanted), home, directory: true, directories };
}
