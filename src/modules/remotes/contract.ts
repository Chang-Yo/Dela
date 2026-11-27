// 远程连接契约。ssh 调用与私钥路径只存在于主进程；渲染端只拿到连接信息与目录清单。
import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';
import type {
  RemoteChannelState,
  RemoteSetupProgress,
  RemoteTask,
} from '../../core/protocol/remote';

export type {
  RemoteChannelState,
  RemoteChannelStatus,
  RemoteSetupProgress,
  RemoteSetupStep,
  RemoteTask,
} from '../../core/protocol/remote';

export interface RemoteConnection {
  id: string;
  label: string;
  /** ssh 的第一个位置参数：`~/.ssh/config` 别名或 `user@host`。 */
  host: string;
  port: number | null;
  /** 私钥文件；null 表示交给 ssh 自己按 config 与 agent 解析。 */
  keyPath: string | null;
  createdAt: string;
}

export interface RemoteDraft {
  label?: string;
  host: string;
  port?: number | null;
  keyPath?: string | null;
}

/** `~/.ssh/config` 里的一台具体主机：新建远程项目时作为候选，选中并连上后才保存为连接。 */
export interface SshConfigHost {
  alias: string;
  hostName: string | null;
  user: string | null;
  port: number | null;
}

export interface RemoteProbe {
  ok: boolean;
  /** 成功时是一行环境摘要，失败时直接展示给用户的原因（主机不可达、认证失败、指纹未确认……）。 */
  message: string;
}

export interface RemotePrepare {
  ok: boolean;
  message: string;
  home: string | null;
}

/** 远端监听端口（/v1/ports）：归属拿不到（别的用户的进程）时 pid/process 缺省。 */
export interface RemotePortEntry {
  port: number;
  pid?: number;
  process?: string;
}

export interface RemotePortTunnel {
  remotePort: number;
  localPort: number;
}

export interface RemotePortsState {
  ports: RemotePortEntry[];
  tunnels: RemotePortTunnel[];
}

export interface RemoteDirectoryEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number | null;
  modifiedAt: number | null;
}

/** 远端条目在文件树里的身份：项目 id + 远端绝对路径。
 *  只用路径作 id 会让两台连接上的同路径目录串成同一个节点：清单缓存、展开态与选中态都会混。 */
export function remoteNodeId(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}

export function withinRemotePath(root: string, path: string): boolean {
  return path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
}

export function remoteAssetUrl(
  projectId: string,
  root: string,
  fromPath: string,
  src: string,
): string {
  // 带协议的地址、协议相对地址与页内锚点都不是「远端相对文件」，原样交回。
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) return src;
  const segments = fromPath.slice(0, fromPath.lastIndexOf('/')).split('/');
  for (const part of src.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  const target = segments.join('/') || '/';
  if (!withinRemotePath(root, target)) return src;
  return `dela-resource://remote-raw/${encodeURIComponent(projectId)}?path=${encodeURIComponent(target)}`;
}

const remoteNodeIdPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\/.+)$/i;

export function parseRemoteNodeId(id: string): { projectId: string; path: string } | null {
  const [, projectId, path] = remoteNodeIdPattern.exec(id) ?? [];
  if (!projectId || !path) return null;
  return { projectId, path };
}

export interface RemoteBrowseResult {
  path: string;
  parent: string | null;
  directories: RemoteDirectoryEntry[];
}

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

const draft = remoteDraftSchema;
const remoteId = z.string().uuid();
const directory = z.string().min(1).max(4096).startsWith('/');

export const remotesContract = defineContract(
  'remotes',
  {
    list: { input: z.undefined(), output: z.custom<RemoteConnection[]>() },
    save: {
      input: draft.extend({ id: remoteId.nullable().optional() }),
      output: z.custom<RemoteConnection>(),
    },
    remove: { input: remoteId, output: z.void() },
    probe: { input: draft, output: z.custom<RemoteProbe>() },
    browse: {
      input: z.object({ draft, path: directory }),
      output: z.custom<RemoteBrowseResult>(),
    },
    mkdir: {
      input: z.object({
        draft,
        parent: directory,
        name: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .refine(
            (value) => !/[/\0]/.test(value) && value !== '.' && value !== '..',
            '文件夹名不合法',
          ),
      }),
      output: z.string(),
    },
    pickKey: { input: z.undefined(), output: z.custom<string | null>() },
    configHosts: { input: z.undefined(), output: z.custom<SshConfigHost[]>() },
    /** 连接：把 helper 引导起来（已连上就直接返回），过程经 setupProgress 一行行推送。 */
    prepare: { input: draft, output: z.custom<RemotePrepare>() },
    helperStates: { input: z.undefined(), output: z.custom<RemoteChannelState[]>() },
    tasks: { input: remoteId, output: z.custom<RemoteTask[]>() },
    cancelTask: {
      input: z.object({ remoteId, taskId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }),
      output: z.void(),
    },
    /** 通道不可用时立刻重新引导，不等自动重试的间隔。 */
    retry: { input: remoteId, output: z.custom<RemoteChannelState>() },
  },
  {
    setupProgress: z.custom<RemoteSetupProgress>(),
    helperState: z.custom<RemoteChannelState[]>(),
  },
);
