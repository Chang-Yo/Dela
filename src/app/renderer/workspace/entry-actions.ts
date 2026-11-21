// 条目动作：归档、升级为项目、导入、拖放移动。
// 只经工作区契约写事实并刷新镜像，不碰视图状态；UI 后续由接线方经回调决定。
import type { QueryClient } from '@tanstack/react-query';
import {
  workspaceArchiveId,
  type WorkspaceEntry,
  relocateWorkspacePath,
} from '../../../modules/workspace/contract';
import { sources } from '../../views';
import { useNoteDrafts } from '../../../modules/note/view';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { useTreeState } from '../navigation/store';
import { localPathsOf, workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import { showToast } from '../../../ui/toast';
import { errorMessage } from '../../../core/protocol/contract';

export async function updateEntry(
  id: string,
  input: { name?: string; parentId?: string | null; kind?: 'folder' | 'project' },
) {
  const item = useWorkspaceStore.getState().workspace.entries.find((entry) => entry.id === id);
  const from = item?.path ?? id;
  for (const key of Object.keys(useNoteDrafts.getState().drafts))
    if (key === from || relocateWorkspacePath(key, from, '') !== key)
      if (!(await useNoteDrafts.getState().save(key)))
        throw new Error('文件尚未保存成功，请先保存后再移动或重命名');
  const result = await workspaceClient.update({ id, patch: input });
  if (result?.fromPath && result.toPath) {
    useNoteDrafts.getState().relocatePaths(result.fromPath, result.toPath);
    useWorkbenchLayout.getState().relocatePaths(result.fromPath, result.toPath);
    const tree = useTreeState.getState();
    useTreeState.setState({
      selected: tree.selected
        ? relocateWorkspacePath(tree.selected, result.fromPath, result.toPath)
        : null,
      expanded: tree.expanded.map((path) =>
        relocateWorkspacePath(path, result.fromPath!, result.toPath!),
      ),
    });
  }
  return result;
}

export type EntryAction =
  'folder' | 'project' | 'note' | 'rename' | 'move' | 'remove' | 'promote' | 'import' | 'archive';

export const runEntryWork = async (work: () => Promise<void>) => {
  try {
    await work();
  } catch (error) {
    showToast({ variant: 'error', title: '条目操作失败', description: errorMessage(error) });
  }
};

export function isDescendant(entries: WorkspaceEntry[], id: string, ancestor: string): boolean {
  let parent = entries.find((e) => e.id === id)?.parentId;
  while (parent) {
    if (parent === ancestor) return true;
    parent = entries.find((e) => e.id === parent)?.parentId;
  }
  return false;
}

export function moveEntry(
  dragId: string,
  targetId: string | null,
  rootId: string | null,
  onMoved?: (targetId: string | null) => void,
) {
  const entries = useWorkspaceStore.getState().workspace.entries;
  const parentId = targetId ?? rootId;
  if (parentId === dragId || (parentId && isDescendant(entries, parentId, dragId))) return;
  void runEntryWork(async () => {
    await updateEntry(dragId, { parentId });
    await useWorkspaceStore.getState().refresh();
    onMoved?.(targetId);
  });
}

export function importDroppedFiles(
  files: File[],
  targetId: string | null,
  rootId: string | null,
  onMoved?: (targetId: string | null) => void,
) {
  void runEntryWork(async () => {
    const paths = localPathsOf(files);
    if (paths.length)
      await workspaceClient.importDroppedFiles({ parentId: targetId ?? rootId, paths });
    await useWorkspaceStore.getState().refresh();
    onMoved?.(targetId);
  });
}

export function importFromDialog(parentId: string | null) {
  void runEntryWork(async () => {
    await workspaceClient.importFiles(parentId);
    await useWorkspaceStore.getState().refresh();
  });
}

export function archiveEntry(id: string, onArchived?: () => void) {
  void runEntryWork(async () => {
    await updateEntry(id, { parentId: workspaceArchiveId });
    await useWorkspaceStore.getState().refresh();
    onArchived?.();
  });
}

export function promoteEntry(id: string, onOpenProject: (id: string) => void) {
  void runEntryWork(async () => {
    const result = await updateEntry(id, { kind: 'project' });
    await useWorkspaceStore.getState().refresh();
    onOpenProject(result.id);
  });
}

export function prefillNoteText(
  activeKey: string | null,
  text: string,
  client: QueryClient,
): string {
  const entries = useWorkspaceStore.getState().workspace.entries;
  const sourceId = activeKey?.startsWith('source:')
    ? activeKey.slice(7)
    : (entries.find((e) => e.id === activeKey)?.sourceId ?? null);
  const name = sourceId ? sources.title(sourceId, client) : undefined;
  const originalUrl = activeKey
    ? useNoteDrafts.getState().drafts[activeKey]?.content.url
    : undefined;
  const header = name ? `来源：${originalUrl ? `[${name}](${originalUrl})` : name}\n\n` : '';
  return text || header;
}
