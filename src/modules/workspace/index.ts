// 工作区：项目与资料条目、本地与远程目录树、文件读写和工作台布局；资料来源与预览协议对其他模块开注册口。
import { defineModule } from '../../app/module';
import { invalidateSessions } from '../../core/agent/session/run';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { registerResourceResolver } from '../../core/capabilities/resources';
import { onRemoteChange } from '../../core/remote/events';
import { emit } from '../../core/ports';
import { registerContextDirectory } from '../../core/agent/context-directories';
import { implement } from '../../core/protocol/contract';
import {
  closeRemotePort,
  openRemoteFile,
  openRemotePort,
  readRemoteDocument,
  remotePortsState,
} from '../remotes';
import { resourceRefSchema, workspaceContract } from './contract';
import { registerSearchProvider } from '../search';
import {
  chooseDirectory,
  downloadRemote,
  exportOfficePdfOf,
  listRemote,
  openFile,
  openLocal,
  pickImportFiles,
  pickProjectFolder,
  remotePathIn,
  remoteReferences,
  remoteTargetOf,
  searchLocal,
  uploadRemote,
  watchRemote,
  workspaceState,
} from './main/actions';
import { workspaceDomain } from './main/agent';
import {
  createWorkspaceEntry,
  importRemoteProject,
  importWorkspaceFiles,
  linkProjectFolder,
  readWorkspaceEntry,
  removeWorkspaceEntry,
  saveNoteImage,
  saveWorkspaceNote,
  updateWorkspaceEntry,
  workspaceRootDirectory,
} from './main/api';
import { loadWorkspaceLayout, saveWorkspaceLayout } from './main/layout';
import { listLocalDirectory, localEntryAncestors, searchLocalWorkspace } from './main/local-tree';
import {
  openProjectDirectory,
  projectGitBranch,
  projectGitBranches,
  projectGitCheckout,
} from './main/project';
import { chatSearch, projectSearch } from './main/search';
import { resourceDomain, workspaceResourceResolver } from './main/read-resource';
import { openResourceFile } from './main/resources';
import { workspaceSource } from './main/sources';

export {
  createWorkspaceEntry,
  entry,
  getWorkspaceState,
  idSchema,
  importRemoteProject,
  importWorkspaceFiles,
  projectLocation,
  readWorkspaceEntry,
  remoteProjectOf,
  removeWorkspaceEntry,
  saveWorkspaceNote,
  updateWorkspaceEntry,
  workspaceFilePath,
  workspaceProjects,
} from './main/api';
export {
  documentHint,
  readDocument,
  resourceDomain,
  workspaceResourceResolver,
} from './main/read-resource';
export {
  prepareDocumentFile,
  prepareDocumentResource,
  readWorkspaceResource,
  releaseDocumentResource,
  withResourceFile,
  type ResourceContent,
} from './main/resources';
export { attachContextMenu } from './main/context-menu';
export { availablePath, diskName } from './main/disk-name';
export { localFileFormat, textRevision } from './main/files';
export { openInVsCode } from './main/project';
export {
  previewFileResponse,
  registerPreviewHost,
  registerPreviewProtocol,
  registerPreviewScheme,
} from './main/preview';
export { registerWorkspaceSource, workspaceSource, type WorkspaceSource } from './main/sources';

export const workspaceModule = defineModule({
  id: 'workspace',
  ipc: implement(workspaceContract, {
    state: workspaceState,
    listLocalDirectory,
    searchLocal: ({ rootId, query }) => searchLocal(rootId, query),
    localReferenceFiles: async (cwd) =>
      (await searchLocalWorkspace(cwd, '')).filter((item) => item.kind === 'file'),
    localAncestors: localEntryAncestors,
    create: createWorkspaceEntry,
    update: ({ id, patch }) => {
      const result = updateWorkspaceEntry(id, patch);
      invalidateSessions();
      return result;
    },
    remove: async (id) => {
      await removeWorkspaceEntry(id);
      invalidateSessions();
    },
    read: readWorkspaceEntry,
    readSource: (id) => workspaceSource(id).preview(id),
    saveNote: ({ id, text, revision }) => saveWorkspaceNote(id, text, revision),
    saveNoteImage: ({ id, name, bytes }) => saveNoteImage(id, name, bytes),
    openProjectDirectory: ({ id, target }) => openProjectDirectory(id, target),
    projectBranch: projectGitBranch,
    projectBranches: projectGitBranches,
    switchProjectBranch: ({ id, branch }) => projectGitCheckout(id, branch),
    exportOfficePdf: exportOfficePdfOf,
    openResourceFile: (ref) => openResourceFile(resourceRefSchema.parse(ref)),
    importFiles: async (parentId) => {
      const paths = await pickImportFiles();
      if (paths.length) importWorkspaceFiles(parentId, paths);
    },
    importDroppedFiles: ({ parentId, paths }) => {
      importWorkspaceFiles(parentId, paths);
    },
    importProjectFolder: async () => {
      const path = await pickProjectFolder();
      return path ? linkProjectFolder(path) : null;
    },
    importRemoteProject: async ({ remoteId, path, name }) => {
      const created = await importRemoteProject(remoteId, path, name);
      invalidateSessions();
      return created;
    },
    listRemoteDirectory: ({ projectId, path }) => listRemote(projectId, path),
    // 远端文件预览只回 DocumentContent，界面与本地条目走同一个预览标签。
    readRemoteDocument: ({ projectId, path }) => {
      const { target, root } = remoteTargetOf(projectId);
      return readRemoteDocument(projectId, target, remotePathIn(root, path));
    },
    downloadRemoteFile: ({ projectId, path }) => downloadRemote(projectId, path),
    openRemoteFile: async ({ projectId, path }) => {
      const { target, root } = remoteTargetOf(projectId);
      await openRemoteFile(target, remotePathIn(root, path));
    },
    uploadRemoteFiles: ({ projectId, directory, paths }) =>
      uploadRemote(projectId, directory, paths),
    remotePorts: (projectId) => remotePortsState(remoteTargetOf(projectId).target),
    openRemotePort: async ({ projectId, port }) => ({
      localPort: await openRemotePort(remoteTargetOf(projectId).target, port),
    }),
    closeRemotePort: ({ projectId, port }) =>
      closeRemotePort(remoteTargetOf(projectId).target, port),
    watchRemoteDirectories: ({ projectId, paths }) => watchRemote(projectId, paths),
    remoteReferences,
    openLocal,
    openFile,
    chooseDirectory,
    layout: loadWorkspaceLayout,
    saveLayout: ({ projectId, layout }) => saveWorkspaceLayout(projectId, layout),
  }),
  register() {
    registerCommandDomain(resourceDomain);
    registerCommandDomain(workspaceDomain);
    registerResourceResolver('workspace', workspaceResourceResolver);
    registerContextDirectory({ id: 'workspace', label: '资料', directory: workspaceRootDirectory });
    registerSearchProvider(projectSearch);
    registerSearchProvider(chatSearch);
    onRemoteChange((path) => emit(workspaceContract, 'remoteChange', path));
  },
});
