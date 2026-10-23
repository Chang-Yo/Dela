import type { DocumentContent, OfficeExportEvent } from './documents';
import type { RemoteDirectoryEntry, RemotePortsState } from './remotes';
import type { ResourceRef } from './resources';
import { z } from 'zod';

/** 普通文件使用绝对磁盘路径；UUID 仅用于项目、资料关联及旧引用。 */
export const workspaceEntryIdSchema = z
  .string()
  .min(1)
  .max(32_767)
  .refine(
    (value) =>
      z.uuid().safeParse(value).success || /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/i.test(value),
    { message: '请选择工作区文件路径或有效的旧引用' },
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

export interface WorkspaceViewState {
  tabs: string[];
  active: string | null;
  expanded: string[];
  scroll: Record<string, number>;
}

export interface WorkspaceState {
  entries: WorkspaceEntry[];
  views: Record<string, WorkspaceViewState>;
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

export interface WorkspaceApi {
  getState(): Promise<WorkspaceState>;
  listLocalDirectory(id: string | null): Promise<WorkspaceEntry[]>;
  searchLocal(rootId: string | null, query: string): Promise<WorkspaceEntry[]>;
  localReferenceFiles(cwd: string): Promise<WorkspaceEntry[]>;
  localAncestors(id: string): Promise<WorkspaceEntry[]>;
  create(input: WorkspaceCreateInput): Promise<WorkspaceEntry>;
  update(
    id: string,
    input: { name?: string; parentId?: string | null; kind?: 'folder' | 'project' },
  ): Promise<WorkspaceEntryUpdate>;
  onChanged(listener: (paths: string[]) => void): () => void;
  remove(id: string): Promise<void>;
  read(id: string): Promise<DocumentContent>;
  /** 原地覆写文本文件；revision 与磁盘不一致时拒绝。 */
  saveNote(id: string, text: string, revision: string): Promise<string>;
  /** 把新插入的本地图片存入 Markdown 文件同目录的 assets/，返回相对路径。 */
  saveNoteImage(id: string, name: string, bytes: Uint8Array): Promise<string>;
  /** 打开项目目录，main 验证项目身份并解析本地路径。 */
  openProjectDirectory(id: string, target: 'vscode' | 'explorer'): Promise<void>;
  /** 本地项目目录的当前 Git 分支；非仓库、目录不存在、git 缺失与远端项目都返回 null。 */
  projectBranch(id: string): Promise<string | null>;
  /** 本地项目的分支名列表（按名字排序）；非仓库与远端项目返回空数组。 */
  projectBranches(id: string): Promise<string[]>;
  /** 切换本地项目的分支；失败时抛出 git 的报错（工作区冲突、分支不存在）。 */
  switchProjectBranch(id: string, branch: string): Promise<void>;
  /** 把 pptx 经 PowerPoint 导出为 PDF（仅 Windows）：存入「预览导出」并建立关联。 */
  exportOfficePdf(ref: ResourceRef): Promise<void>;
  /** 用系统默认应用打开资源的本地源文件（如 PowerPoint 打开 pptx），仅限资料与我的资料条目。 */
  openResourceFile(ref: ResourceRef): Promise<void>;
  onOfficeExportProgress(listener: (event: OfficeExportEvent) => void): () => void;
  importFiles(parentId: string | null): Promise<void>;
  /** 选择电脑上已有的文件夹登记为项目（目录留在原处）；取消选择返回 null。 */
  importProjectFolder(): Promise<WorkspaceEntry | null>;
  /** 把远端目录登记为远程项目：local_path 存远端绝对路径，工具经 SSH 在远端执行。 */
  /** name 缺省时用目录名。同一远端目录重复登记返回已有项目（名字不改）。 */
  importRemoteProject(remoteId: string, path: string, name?: string): Promise<WorkspaceEntry>;
  /** 远程目录的一层内容（懒加载，展开时才拉）。 */
  listRemoteDirectory(projectId: string, path: string): Promise<RemoteDirectoryEntry[]>;
  /** 远端文件的只读预览内容：文本给片段，PDF/Office 给按需分块的地址。 */
  readRemoteDocument(projectId: string, path: string): Promise<DocumentContent>;
  /** 下载远端文件到本地：弹保存对话框，取消返回 null。 */
  downloadRemoteFile(projectId: string, path: string): Promise<string | null>;
  /** 用系统默认程序打开远端文件（下载到临时目录后交给 shell）。 */
  openRemoteFile(projectId: string, path: string): Promise<void>;
  /** 上传本地文件到远端目录；files 为 null 时弹选择框。返回写好的远端路径。 */
  uploadRemoteFiles(projectId: string, directory: string, files: File[] | null): Promise<string[]>;
  /** 远端某个目录可能变了（工具写过文件或跑过 bash）；返回取消订阅。 */
  onRemoteChange(listener: (path: string) => void): () => void;
  /** 远端监听端口与已开隧道（端口预览面板一次拿全）；需要 helper 通道。 */
  remotePorts(projectId: string): Promise<RemotePortsState>;
  /** 开（或复用）一条远端端口隧道并在系统浏览器打开；返回本地端口。 */
  openRemotePort(projectId: string, port: number): Promise<{ localPort: number }>;
  closeRemotePort(projectId: string, port: number): Promise<void>;
  /** 报上当前展开的远端目录做 watch（空数组 = 取消）；回报真正被监视的目录数。 */
  watchRemoteDirectories(projectId: string, paths: string[]): Promise<{ watching: number }>;
  /** 远程项目的 @ 候选：key 为远端绝对路径，title 为相对项目目录的路径。 */
  remoteReferences(projectId: string): Promise<{ key: string; title: string }[]>;
  importDroppedFiles(parentId: string | null, files: File[]): Promise<void>;
  openLocal(id: string): Promise<void>;
  /** 用系统默认程序打开本地文件（目录不适用；远端条目走远端打开）。 */
  openFile(id: string): Promise<void>;
  chooseDirectory(): Promise<string>;
}
