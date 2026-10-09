import { webUtils } from 'electron';
import type { OfficeExportEvent, WorkspaceApi, WorkspaceCreateInput } from '../shared/api';
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
  /** 远端某个目录可能变了（工具写过文件或跑过 bash）：目录树据此重读。 */
  onRemoteChange: (listener: (path: string) => void) => on('workspace:remote-change', listener),
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
