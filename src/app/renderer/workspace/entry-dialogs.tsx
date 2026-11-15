// 工作区 CRUD 弹窗：新建项目/文件夹/文件、重命名、移动、移除、链接资料。
// 弹窗只负责表单与 workspace:* 通道调用，「成功之后」的动作由接线方经回调接手。
import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Cloud, FolderOpen } from 'lucide-react';
import { sourceTitle } from '../../app/views';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import type { WorkspaceEntry } from '../../modules/workspace/contract';
import { parseRemoteNodeId } from '../../modules/remotes/contract';
import { workspaceClient, useWorkspaceStore } from '../../modules/workspace/view';
import { useNoteDrafts } from '../../modules/note/view';
import { updateEntry, type EntryAction } from './entry-actions';
import { NewRemoteProjectDialog } from './remote/NewRemoteProjectDialog';
import { ErrorText } from '../../ui/alert';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../ui/dialog';
import { Field } from '../../ui/field';
import { errorMessage } from '../../core/protocol/contract';

/** Radix Select 的 Item 不接受空串值，「我的内容」（根）用哨兵表示。 */
const ROOT_SELECT_VALUE = '__root__';

export interface EntryDialogRequest {
  action: EntryAction | 'link';
  id: string | null;
  /** note（新建文件）弹窗的正文预填：带正文时是「保存为笔记」，名称预填 .md。 */
  text?: string;
  /** link/move 打开时预选的目标位置。 */
  initialTarget?: string;
}

// promote/import/archive 由接线处直连 entry-actions，永不入弹窗。
const titles: Partial<Record<EntryDialogRequest['action'], string>> = {
  folder: '新建文件夹',
  project: '新建项目',
  note: '新建文件',
  rename: '重命名',
  move: '移动到',
  remove: '移除内容',
  link: '添加到项目',
};

/** 标签页与目录共用的条目标题解析。 */
export function titleOf(key: string, client: QueryClient): string {
  const { workspace } = useWorkspaceStore.getState();
  // 远端预览标签的 key 是「项目 id + 远端绝对路径」，条目树里没有它，标题取文件名。
  const remote = parseRemoteNodeId(key);
  if (remote) return remote.path.slice(remote.path.lastIndexOf('/') + 1);
  return (
    workspace.entries.find((e) => e.id === key)?.name ??
    (key.startsWith('source:') ? sourceTitle(key.slice(7), client) : undefined) ??
    useNoteDrafts.getState().drafts[key]?.content.title ??
    // 纯磁盘路径标签（Agent 刚产出的文件可能晚于镜像刷新）：镜像没有就直接取路径末段。
    (/[\\/]/.test(key)
      ? key.slice(Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\')) + 1) || key
      : '资料')
  );
}

export function EntryDialogs({
  request,
  onClose,
  onCreated,
  onRemoved,
  onOpenProject,
}: {
  request: EntryDialogRequest | null;
  /** 取消或成功提交后关闭；busy 期间不可关。 */
  onClose: () => void;
  /** create/link 成功后回调：打开新建文件、展开父级等由接线方决定。 */
  onCreated?: (entry: WorkspaceEntry) => void;
  /** remove 成功后回调仍存活的条目 id 集合；接线方据此清理标签与草稿、退出已删项目。 */
  onRemoved?: (liveIds: Set<string>) => void;
  /** 新建项目后打开（promote 的打开在 entry-actions.promoteEntry 回调）。 */
  onOpenProject?: (id: string) => void;
}) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  /** 远程向导：自带对话框与进行中状态，打开时让出外层弹窗（避免两层遮罩叠在一起）。 */
  const [wizard, setWizard] = useState(false);

  useEffect(() => {
    setName(
      request?.action === 'rename'
        ? (useWorkspaceStore.getState().workspace.entries.find((e) => e.id === request.id)?.name ??
            '')
        : request?.action === 'note' && request.text !== undefined
          ? '新笔记.md'
          : '',
    );
    setTarget(request?.initialTarget ?? '');
    setModalError(null);
  }, [request]);

  const projects = workspace.entries.filter((entry) => entry.kind === 'project' && !entry.remoteId);
  let targetProject = workspace.entries.find((entry) => entry.id === target);
  while (targetProject && targetProject.kind !== 'project')
    targetProject = workspace.entries.find((entry) => entry.id === targetProject!.parentId);
  const linkTarget =
    target === '__new__'
      ? target
      : (projects.find((entry) => entry.id === targetProject?.id)?.id ?? '');

  const pathName = (entry: WorkspaceEntry): string => {
    const names = [entry.name];
    let parent = workspace.entries.find((e) => e.id === entry.parentId);
    while (parent) {
      names.unshift(parent.name);
      parent = workspace.entries.find((e) => e.id === parent!.parentId);
    }
    return names.join(' / ');
  };

  /** 导入电脑上已有的文件夹作为项目：目录留在原处，成功后与新建项目走同一套后续动作。 */
  const importFolder = async () => {
    if (!window.dela || busy) return;
    setBusy(true);
    setModalError(null);
    try {
      const created = await workspaceClient.importProjectFolder();
      if (!created) return;
      await useWorkspaceStore.getState().refresh();
      onClose();
      onOpenProject?.(created.id);
      onCreated?.(created);
    } catch (error) {
      setModalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request || !window.dela) return;
    if (request.action === 'promote' || request.action === 'import' || request.action === 'archive')
      return; // 类型上仍可能出现（壳的 openDialog 入参未收窄），但表单对它们没有意义。
    setBusy(true);
    setModalError(null);
    try {
      let created: WorkspaceEntry | undefined;
      if (request.action === 'rename') await updateEntry(request.id!, { name });
      else if (request.action === 'move')
        await updateEntry(request.id!, { parentId: target || null });
      else if (request.action === 'remove') {
        await workspaceClient.remove(request.id!);
        const remaining = (await workspaceClient.state()).entries;
        onRemoved?.(new Set(remaining.map((e) => e.id)));
      } else if (request.action === 'link') {
        const sourceId = request.id!.startsWith('source:')
          ? request.id!.slice(7)
          : workspace.entries.find((e) => e.id === request.id)?.sourceId;
        if (!sourceId) throw new Error('请选择来源资料');
        if (!linkTarget) throw new Error('请选择项目');
        let parentId = linkTarget;
        if (linkTarget === '__new__')
          parentId = (await workspaceClient.create({ name, parentId: null, kind: 'project' })).id;
        created = await workspaceClient.create({
          name: titleOf(request.id!, queryClient),
          parentId,
          kind: 'source',
          sourceId,
        });
      } else if (
        request.action === 'folder' ||
        request.action === 'project' ||
        request.action === 'note'
      )
        created = await workspaceClient.create({
          name,
          parentId: request.id,
          kind: request.action === 'note' ? 'file' : request.action,
          text: request.text,
        });
      await useWorkspaceStore.getState().refresh();
      onClose();
      if (created) {
        if (created.kind === 'project') onOpenProject?.(created.id);
        onCreated?.(created);
      }
    } catch (error) {
      setModalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={request !== null && !wizard}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{request ? (titles[request.action] ?? '') : ''}</DialogTitle>
        <DialogDescription>
          {request?.action === 'remove'
            ? workspace.entries.find((entry) => entry.id === request.id)?.kind === 'project'
              ? workspace.entries.find((entry) => entry.id === request.id)?.remoteId
                ? '从 Dela 移除项目并删除其全部聊天记录；远端目录与文件保留。'
                : '从 Dela 移除项目并删除其全部聊天记录；目录与文件保留。'
              : workspace.entries.find((entry) => entry.id === request.id)?.kind === 'source'
                ? '解除此处的资料关联，原始资料保留。'
                : '将文件或文件夹移至系统回收站。'
            : request?.action === 'link'
              ? '在项目根目录引用资料，原位置保持不变。'
              : request?.action === 'note'
                ? '文件名原样使用，笔记请以 .md 结尾；可用 / 写子路径，如 课程/第一周.md。'
                : request?.action === 'project'
                  ? '新建空项目，或导入电脑上已有的文件夹。'
                  : '按自己的主题组织内容。'}
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4">
          {(request?.action === 'link' || request?.action === 'move') && (
            <div className="grid gap-2 text-sm">
              {request.action === 'link' ? '项目' : '位置'}
              <Select
                onValueChange={(value) => setTarget(value === ROOT_SELECT_VALUE ? '' : value)}
                value={request.action === 'link' ? linkTarget : target || ROOT_SELECT_VALUE}
              >
                <SelectTrigger
                  aria-label={request.action === 'link' ? '目标项目' : '目标文件夹'}
                  className="w-full"
                >
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {request.action === 'move' && (
                    <SelectItem value={ROOT_SELECT_VALUE}>我的内容</SelectItem>
                  )}
                  {(request.action === 'link'
                    ? projects
                    : workspace.entries.filter(
                        (e) =>
                          (e.kind === 'folder' || e.kind === 'project') && e.id !== request?.id,
                      )
                  ).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {request.action === 'link' ? e.name : pathName(e)}
                    </SelectItem>
                  ))}
                  {request.action === 'link' && <SelectItem value="__new__">新建项目…</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          {request &&
            !['move', 'remove'].includes(request.action) &&
            (request.action !== 'link' || target === '__new__') && (
              <Field label="名称">
                <Input
                  autoFocus
                  autoComplete="off"
                  aria-label="名称"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            )}
          {request?.action === 'project' && (
            <div className="grid gap-2">
              <div aria-hidden="true" className="flex items-center gap-3 text-xs">
                <span className="h-px flex-1 bg-line" />
                <span className="text-ink-3">或</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <Button
                disabled={busy}
                onClick={() => void importFolder()}
                type="button"
                variant="secondary"
              >
                <FolderOpen />
                导入已有文件夹
              </Button>
              <Button
                disabled={busy}
                onClick={() => setWizard(true)}
                type="button"
                variant="secondary"
              >
                <Cloud />
                新建远程项目
              </Button>
            </div>
          )}
          {modalError && <ErrorText>{modalError}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || (request?.action === 'link' && !linkTarget)}
              variant={request?.action === 'remove' ? 'destructive' : undefined}
            >
              {busy ? '处理中…' : request?.action === 'remove' ? '移除' : '确定'}
            </Button>
          </div>
        </form>
      </DialogContent>
      {/* 向导有自己的对话框：外层弹窗打开它时关闭，取消后回到新建项目。 */}
      <NewRemoteProjectDialog
        open={wizard}
        onClose={() => setWizard(false)}
        onImported={(entry) => {
          // 与「导入已有文件夹」同一套后续动作：刷新镜像已由向导完成。
          setWizard(false);
          onClose();
          onOpenProject?.(entry.id);
          onCreated?.(entry);
        }}
      />
    </Dialog>
  );
}
