import type { DocumentContent, OfficeExportEvent } from './documents';
import type { ResourceRef } from './resources';

export interface WorkspaceEntry {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project' | 'note' | 'source' | 'local' | 'imported';
  sourceId: string | null;
  noteId: string | null;
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
  ): Promise<void>;
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
  /** 用系统 Quick Look 预览条目文件（仅 macOS）。 */
  quickLookFile(ref: ResourceRef): Promise<void>;
  importFiles(parentId: string | null): Promise<void>;
  importDroppedFiles(parentId: string | null, files: File[]): Promise<void>;
  openLocal(id: string): Promise<void>;
  chooseDirectory(): Promise<string>;
}
