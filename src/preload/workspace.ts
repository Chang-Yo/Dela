import { webUtils } from 'electron';
import type { OfficeExportEvent, WorkspaceApi, WorkspaceCreateInput } from '../shared/api';
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
  quickLookFile: (ref: ResourceRef) => invoke('workspace:quick-look', ref),
  importFiles: (parentId: string | null) => invoke('workspace:import-files', parentId),
  importDroppedFiles: (parentId: string | null, files: File[]) => {
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    return paths.length
      ? invoke('workspace:import-dropped-files', parentId, paths)
      : Promise.resolve();
  },
  openLocal: (id: string) => invoke('workspace:open-local', id),
  chooseDirectory: () => invoke('workspace:choose-directory'),
} satisfies WorkspaceApi;
