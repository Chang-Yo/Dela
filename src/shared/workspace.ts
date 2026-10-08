import type { DocumentContent, OfficeExportEvent } from './documents';
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
  if (path.startsWith(`${from}\\`) || path.startsWith(`${from}/`))
    return `${to}${path.slice(from.length)}`;
  return path;
}

export interface WorkspaceEntry {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project' | 'note' | 'source' | 'local' | 'imported';
  sourceId: string | null;
  path?: string;
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
}

export interface WorkspaceCreateInput {
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project' | 'note' | 'source';
  sourceId?: string;
  text?: string;
}

export interface WorkspaceApi {
  getState(): Promise<WorkspaceState>;
  create(input: WorkspaceCreateInput): Promise<WorkspaceEntry>;
  update(
    id: string,
    input: { name?: string; parentId?: string | null; kind?: 'folder' | 'project' },
  ): Promise<WorkspaceEntryUpdate>;
  onChanged(listener: () => void): () => void;
  remove(id: string): Promise<void>;
  read(id: string): Promise<DocumentContent>;
  saveNote(id: string, text: string, revision: string): Promise<string>;
  /** 把新插入的本地图片存入笔记目录 assets/，返回相对路径。 */
  saveNoteImage(id: string, name: string, bytes: Uint8Array): Promise<string>;
  /** 打开项目目录，main 验证项目身份并解析本地路径。 */
  openProjectDirectory(id: string, target: 'vscode' | 'explorer'): Promise<void>;
  /** 把 pptx 经 PowerPoint 导出为 PDF（仅 Windows）：存入「预览导出」并建立关联。 */
  exportOfficePdf(ref: ResourceRef): Promise<void>;
  /** pptx 导出过程的阶段与进度通知。 */
  onOfficeExportProgress(listener: (event: OfficeExportEvent) => void): () => void;
  importFiles(parentId: string | null): Promise<void>;
  /** 选择电脑上已有的文件夹登记为项目（目录留在原处）；取消选择返回 null。 */
  importProjectFolder(): Promise<WorkspaceEntry | null>;
  importDroppedFiles(parentId: string | null, files: File[]): Promise<void>;
  openLocal(id: string): Promise<void>;
  chooseDirectory(): Promise<string>;
}
