import { webUtils } from 'electron';
import type { OfficeExportEvent, WorkspaceApi, WorkspaceCreateInput } from '../shared/api';
import type { DocumentContent } from '../shared/documents';
import type { RemoteDirectoryEntry } from '../shared/remotes';
import type { ResourceRef } from '../shared/resources';
import { invoke, on } from './lib';

export const workspace = {
  getState: () => invoke('workspace:get-state'),
  onChanged: (listener: () => void) => on('workspace:changed', listener),
  create: (input: WorkspaceCreateInput) => invoke('workspace:create', input),
  update: (
    id: string,
    input: { name?: string; parentId?: string | null; kind?: 'folder' | 'project' },
  ) => invoke('workspace:update', id, input),
  remove: (id: string) => invoke('workspace:remove', id),
  read: (id: string) => invoke('workspace:read', id),
  saveNote: (id: string, text: string, revision: string) =>
    invoke('workspace:save-note', id, text, revision),
  saveNoteImage: (id: string, name: string, bytes: Uint8Array) =>
    invoke('workspace:save-note-image', id, name, bytes) as Promise<string>,
  openProjectDirectory: (id: string, target: 'vscode' | 'explorer') =>
    invoke('workspace:open-project-directory', id, target),
  exportOfficePdf: (ref: ResourceRef) => invoke('workspace:export-office-pdf', ref),
  onOfficeExportProgress: (listener: (event: OfficeExportEvent) => void) =>
    on<OfficeExportEvent>('workspace:export-office-progress', listener),
  importFiles: (parentId: string | null) => invoke('workspace:import-files', parentId),
  importProjectFolder: () => invoke('workspace:import-project-folder'),
  importRemoteProject: (remoteId: string, path: string) =>
    invoke('workspace:import-remote-project', remoteId, path),
  listRemoteDirectory: (projectId: string, path: string) =>
    invoke('workspace:list-remote', projectId, path) as Promise<RemoteDirectoryEntry[]>,
  readRemoteDocument: (projectId: string, path: string) =>
    invoke('workspace:read-remote-document', projectId, path) as Promise<DocumentContent>,
  downloadRemoteFile: (projectId: string, path: string) =>
    invoke('workspace:download-remote-file', projectId, path) as Promise<string | null>,
  openRemoteFile: (projectId: string, path: string) =>
    invoke('workspace:open-remote-file', projectId, path) as Promise<void>,
  uploadRemoteFiles: (projectId: string, directory: string, files: File[] | null) => {
    // 拖放文件与「选文件上传」共用一条通道：前者在这里换成磁盘路径，后者交给主进程弹框。
    const paths = files?.map((file) => webUtils.getPathForFile(file)).filter(Boolean) ?? null;
    return invoke('workspace:upload-remote-files', projectId, directory, paths) as Promise<
      string[]
    >;
  },
  /** 远端某个目录可能变了（工具写过文件或跑过 bash）：目录树据此重读。 */
  onRemoteChange: (listener: (path: string) => void) => on('workspace:remote-change', listener),
  /** 报上当前展开的远端目录，让远端帮我们盯着它们（空数组 = 取消监视）。 */
  watchRemoteDirectories: (projectId: string, paths: string[]) =>
    invoke('workspace:watch-remote', projectId, paths) as Promise<{ watching: number }>,
  remoteReferences: (projectId: string) =>
    invoke('workspace:remote-references', projectId) as Promise<{ key: string; title: string }[]>,
  importDroppedFiles: (parentId: string | null, files: File[]) => {
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    return paths.length
      ? invoke('workspace:import-dropped-files', parentId, paths)
      : Promise.resolve();
  },
  openLocal: (id: string) => invoke('workspace:open-local', id),
  chooseDirectory: () => invoke('workspace:choose-directory'),
} satisfies WorkspaceApi;
