import type { DocumentContent, OfficeExportEvent } from '../../shared/documents';
import type { RemoteDirectoryEntry, RemotePortsState } from '../../shared/remotes';
import { workbenchLayoutSchema, type WorkbenchLayout } from '../../shared/layout';
import type { ResourceRef } from '../../shared/resources';
import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

// 内容标签（note、preview）的视图经这里取共享类型，shared/ 收进模块后改为就地定义。
export type {
  DocumentContent,
  OfficeExportEvent,
  OfficeExportInfo,
  OfficeExportProgress,
} from '../../shared/documents';
export type { TabId } from '../../shared/layout';
export type { ResourceRef } from '../../shared/resources';
export { parseRemoteNodeId } from '../../shared/remotes';

/** 普通文件使用绝对磁盘路径；UUID 用于已登记的项目与资料条目。 */
export const workspaceEntryIdSchema = z
  .string()
  .min(1)
  .max(32_767)
  .refine(
    (value) =>
      z.uuid().safeParse(value).success || /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/i.test(value),
    { message: '请选择工作区文件路径或有效的条目' },
  );

export interface WorkspaceEntryUpdate {
  id: string;
  /** 应用内移动/重命名时同步已有标签与草稿。 */
  fromPath?: string;
  toPath?: string;
}

export function relocateWorkspacePath(path: string, from: string, to: string): string {
  if (path === from) return to;
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(from);
  if (path.startsWith(`${from}/`) || (windows && path.startsWith(`${from}\\`)))
    return `${to}${path.slice(from.length)}`;
  return path;
}

export interface WorkspaceEntry {
  gitIgnored?: boolean;
  id: string;
  parentId: string | null;
  name: string;
  /** file 是磁盘上的任意文件，格式在打开时按内容判定（shared/files）。 */
  kind: 'folder' | 'project' | 'file' | 'source';
  sourceId: string | null;
  path?: string;
  /** 远程项目及其子条目标记：path 是远端 POSIX 绝对路径，本地磁盘上没有对应文件。 */
  remoteId?: string | null;
  updatedAt: string;
}

export const workspaceArchiveId = '00000000-0000-4000-8000-000000000001';

export const hiddenWorkspaceNames = new Set(['.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db']);

export interface WorkspaceState {
  entries: WorkspaceEntry[];
  directory: string;
  archivePath?: string;
}

export interface WorkspaceCreateInput {
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project' | 'file' | 'source';
  sourceId?: string;
  text?: string;
}

const entryId = workspaceEntryIdSchema;
const projectId = workspaceEntryIdSchema;
const remotePath = z.string().min(1).max(4096);
const localPaths = z.array(z.string().min(1).max(32_767)).max(100);
const port = z.number().int().min(1).max(65535);
const entries = z.custom<WorkspaceEntry[]>();
const document = z.custom<DocumentContent>();
/** 由主进程按 resourceRefSchema 校验：它依赖本文件的条目 id，放在这里会循环引用。 */
const resourceRef = z.custom<ResourceRef>();

export const workspaceContract = defineContract(
  'workspace',
  {
    /** 读取工作区状态，并开始监视顶层目录的变化。 */
    state: { input: z.undefined(), output: z.custom<WorkspaceState>() },
    listLocalDirectory: { input: entryId.nullable(), output: entries },
    /** 新的搜索会中止同一根目录上进行中的搜索；空查询返回空数组。 */
    searchLocal: {
      input: z.object({ rootId: entryId.nullable(), query: z.string().max(200) }),
      output: entries,
    },
    localReferenceFiles: { input: entryId, output: entries },
    localAncestors: { input: entryId, output: entries },
    create: { input: z.custom<WorkspaceCreateInput>(), output: z.custom<WorkspaceEntry>() },
    update: {
      input: z.object({
        id: entryId,
        patch: z.custom<{ name?: string; parentId?: string | null; kind?: 'folder' | 'project' }>(),
      }),
      output: z.custom<WorkspaceEntryUpdate>(),
    },
    remove: { input: entryId, output: z.void() },
    read: { input: entryId, output: document },
    /** 来源资料（Canvas 课件、水源帖子等）的正文，由认领该 sourceId 的模块读取。 */
    readSource: { input: z.string().max(512), output: document },
    /** 原地覆写文本文件；revision 与磁盘不一致时拒绝。 */
    saveNote: {
      input: z.object({
        id: entryId,
        text: z.string().max(2_000_000),
        revision: z.string().length(64),
      }),
      output: z.string(),
    },
    /** 把新插入的本地图片存入 Markdown 文件同目录的 assets/，返回相对路径。 */
    saveNoteImage: {
      input: z.object({
        id: entryId,
        name: z
          .string()
          .min(1)
          .max(200)
          .refine((value) => !value.includes('/') && !value.includes('\\')),
        bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0),
      }),
      output: z.string(),
    },
    openProjectDirectory: {
      input: z.object({ id: projectId, target: z.enum(['vscode', 'explorer']) }),
      output: z.void(),
    },
    /** 本地项目的当前 Git 分支；非仓库、git 缺失与远端项目都返回 null。 */
    projectBranch: { input: projectId, output: z.custom<string | null>() },
    projectBranches: { input: projectId, output: z.custom<string[]>() },
    /** 分支名会直接作为 git 的参数：不允许以 - 开头，避免被当成选项。 */
    switchProjectBranch: {
      input: z.object({
        id: projectId,
        branch: z
          .string()
          .min(1)
          .max(255)
          .refine((value) => !value.startsWith('-')),
      }),
      output: z.void(),
    },
    /** 把 pptx 经 PowerPoint 导出为 PDF（仅 Windows），进度经 officeExportProgress 推送。 */
    exportOfficePdf: { input: resourceRef, output: z.void() },
    openResourceFile: { input: resourceRef, output: z.void() },
    importFiles: { input: entryId.nullable(), output: z.void() },
    importDroppedFiles: {
      input: z.object({ parentId: entryId.nullable(), paths: localPaths.min(1) }),
      output: z.void(),
    },
    /** 选择已有文件夹登记为项目（目录留在原处）；取消返回 null。 */
    importProjectFolder: { input: z.undefined(), output: z.custom<WorkspaceEntry | null>() },
    /** 把远端目录登记为远程项目；同一目录重复登记返回已有项目。 */
    importRemoteProject: {
      input: z.object({ remoteId: z.string(), path: z.string(), name: z.string().optional() }),
      output: z.custom<WorkspaceEntry>(),
    },
    listRemoteDirectory: {
      input: z.object({ projectId, path: remotePath }),
      output: z.custom<RemoteDirectoryEntry[]>(),
    },
    readRemoteDocument: { input: z.object({ projectId, path: remotePath }), output: document },
    /** 弹保存对话框下载到本地，取消返回 null。 */
    downloadRemoteFile: {
      input: z.object({ projectId, path: remotePath }),
      output: z.custom<string | null>(),
    },
    openRemoteFile: { input: z.object({ projectId, path: remotePath }), output: z.void() },
    /** paths 为 null 时弹选择框；返回写好的远端路径。 */
    uploadRemoteFiles: {
      input: z.object({ projectId, directory: remotePath, paths: localPaths.nullable() }),
      output: z.custom<string[]>(),
    },
    remotePorts: { input: projectId, output: z.custom<RemotePortsState>() },
    openRemotePort: {
      input: z.object({ projectId, port }),
      output: z.custom<{ localPort: number }>(),
    },
    closeRemotePort: { input: z.object({ projectId, port }), output: z.void() },
    /** 报上当前展开的远端目录做监视（空数组即取消），回报真正监视的目录数。 */
    watchRemoteDirectories: {
      input: z.object({ projectId, paths: z.array(remotePath).max(4096) }),
      output: z.custom<{ watching: number }>(),
    },
    /** 远程项目的 @ 候选：key 为远端绝对路径，title 为相对项目目录的路径。 */
    remoteReferences: { input: projectId, output: z.custom<{ key: string; title: string }[]>() },
    openLocal: { input: entryId, output: z.void() },
    openFile: { input: entryId, output: z.void() },
    chooseDirectory: { input: z.undefined(), output: z.string() },
    /** 工作台布局按项目保存（null 为首页）；损坏的数据按未保存处理。 */
    layout: { input: z.uuid().nullable(), output: z.custom<WorkbenchLayout | null>() },
    saveLayout: {
      input: z.object({ projectId: z.uuid().nullable(), layout: workbenchLayoutSchema }),
      output: z.void(),
    },
  },
  {
    /** 本地目录下有条目增删或改名。 */
    changed: z.custom<string[]>(),
    officeExportProgress: z.custom<OfficeExportEvent>(),
    /** 远端某个目录可能变了（工具写过文件、跑过 bash 或远端监视报告）。 */
    remoteChange: z.string(),
  },
);
