// 条目动作（迁移自 ProjectView 的 action/move 段）：归档、升级为项目、导入、拖放移动。
// 动作只经 preload workspace:* 通道写事实并刷新镜像；展开落点、打开项目等 UI 后续
// 由接线方经回调决定，动作本身不碰视图状态。
import { workspaceArchiveId, type WorkspaceEntry } from '../../shared/api';
import { useNoteDrafts } from './drafts';
import { errorText, useWorkspaceStore } from './store';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { useNavigationStore as useTreeState } from '../navigation/store';
import { relocateWorkspacePath } from '../../shared/workspace';
import { showToast } from '../app/toasts';

/** 重命名前先冲盘，成功后一次迁移本窗口已知路径与草稿。 */
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
  const result = await window.dela!.workspace.update(id, input);
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
    showToast({ variant: 'error', title: '条目操作失败', description: errorText(error) });
  }
};

/** id 是否位于 ancestor 的子树内（含多级）；移动落点合法性检查用。 */
export function isDescendant(entries: WorkspaceEntry[], id: string, ancestor: string): boolean {
  let parent = entries.find((e) => e.id === id)?.parentId;
  while (parent) {
    if (parent === ancestor) return true;
    parent = entries.find((e) => e.id === parent)?.parentId;
  }
  return false;
}

/** 拖放移动条目；把条目移进自身子树的操作静默忽略（旧 ProjectView.move 行为）。 */
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

/** 拖放导入本地文件到目标目录（targetId 为 null 时落到 rootId）。 */
export function importDroppedFiles(
  files: File[],
  targetId: string | null,
  rootId: string | null,
  onMoved?: (targetId: string | null) => void,
) {
  void runEntryWork(async () => {
    await window.dela!.workspace.importDroppedFiles(targetId ?? rootId, files);
    await useWorkspaceStore.getState().refresh();
    onMoved?.(targetId);
  });
}

/** 经系统对话框导入本地文件。 */
export function importFromDialog(parentId: string | null) {
  void runEntryWork(async () => {
    await window.dela!.workspace.importFiles(parentId);
    await useWorkspaceStore.getState().refresh();
  });
}

/** 归档条目（移入归档区）；onArchived 用于展开「归档」区。 */
export function archiveEntry(id: string, onArchived?: () => void) {
  void runEntryWork(async () => {
    await updateEntry(id, { parentId: workspaceArchiveId });
    await useWorkspaceStore.getState().refresh();
    onArchived?.();
  });
}

/** 文件夹升级为项目并打开。 */
export function promoteEntry(id: string, onOpenProject: (id: string) => void) {
  void runEntryWork(async () => {
    const result = await updateEntry(id, { kind: 'project' });
    await useWorkspaceStore.getState().refresh();
    onOpenProject(result.id);
  });
}

/** 新建笔记的正文预填：显式 text 优先；否则按当前打开的资料拼来源 header（旧 newNote）。 */
export function prefillNoteText(activeKey: string | null, text: string): string {
  const { workspace, canvas } = useWorkspaceStore.getState();
  const entries = workspace.entries;
  const sourceId = activeKey?.startsWith('source:')
    ? activeKey.slice(7)
    : (entries.find((e) => e.id === activeKey)?.sourceId ?? null);
  const source = sourceId ? canvas.items.find((i) => i.sourceId === sourceId) : null;
  const originalUrl = activeKey
    ? useNoteDrafts.getState().drafts[activeKey]?.content.url
    : undefined;
  const header = source
    ? `来源：${originalUrl ? `[${source.name}](${originalUrl})` : source.name}\n\n`
    : '';
  return text || header;
}
