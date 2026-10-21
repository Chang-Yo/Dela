// 工作区 CRUD 弹窗：新建项目/文件夹/文件、重命名、移动、移除、链接资料、连接 Canvas。
// 弹窗只负责表单与 workspace:*/canvas:* 通道调用，「成功之后」的动作由接线方经回调接手。
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { Cloud, FolderOpen } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import type { WorkspaceEntry } from '../../shared/api';
import { parseRemoteNodeId } from '../../shared/remotes';
import { unhideProjectInNav, useProjectNavPrefs } from '../navigation/store';
import { useNoteDrafts } from '../content/note/drafts';
import { updateEntry, type EntryAction } from './entry-actions';
import { errorText, useWorkspaceStore } from './store';
import { RemoteConnectionWizard } from './remote-wizard';
import { dialogOverlay, dialogPanel } from '../components/ui/motion';
import { cn } from '../lib/utils';

/** Radix Select 的 Item 不接受空串值，「我的内容」（根）用哨兵表示。 */
const ROOT_SELECT_VALUE = '__root__';

export interface EntryDialogRequest {
  action: EntryAction | 'link' | 'connect';
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
  connect: '连接 Canvas',
};

/** 标签页与目录共用的条目标题解析。 */
export function titleOf(key: string): string {
  const { workspace, canvas } = useWorkspaceStore.getState();
  // 远端预览标签的 key 是「项目 id + 远端绝对路径」，条目树里没有它，标题取文件名。
  const remote = parseRemoteNodeId(key);
  if (remote) return remote.path.slice(remote.path.lastIndexOf('/') + 1);
  return (
    workspace.entries.find((e) => e.id === key)?.name ??
    canvas.items.find((i) => `source:${i.sourceId}` === key)?.name ??
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
  const projectPrefs = useProjectNavPrefs((s) => s.projects);
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

  const projects = workspace.entries.filter(
    (entry) => entry.kind === 'project' && !entry.remoteId && !projectPrefs[entry.id]?.hidden,
  );
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
      const created = await window.dela.workspace.importProjectFolder();
      if (!created) return;
      await useWorkspaceStore.getState().refresh();
      onClose();
      onOpenProject?.(created.id);
      onCreated?.(created);
    } catch (error) {
      setModalError(errorText(error));
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
      const api = window.dela.workspace;
      let created: WorkspaceEntry | undefined;
      if (request.action === 'connect') {
        await window.dela.canvas.configure(name);
        setName('');
        useWorkspaceStore.getState().setCanvas(await window.dela.canvas.syncCourses());
      } else if (request.action === 'rename') await updateEntry(request.id!, { name });
      else if (request.action === 'move')
        await updateEntry(request.id!, { parentId: target || null });
      else if (request.action === 'remove') {
        await api.remove(request.id!);
        const remaining = (await api.getState()).entries;
        onRemoved?.(new Set(remaining.map((e) => e.id)));
      } else if (request.action === 'link') {
        const sourceId = request.id!.startsWith('source:')
          ? request.id!.slice(7)
          : workspace.entries.find((e) => e.id === request.id)?.sourceId;
        if (!sourceId) throw new Error('请选择来源资料');
        if (!linkTarget) throw new Error('请选择项目');
        let parentId = linkTarget;
        if (linkTarget === '__new__')
          parentId = (await api.create({ name, parentId: null, kind: 'project' })).id;
        created = await api.create({
          name: titleOf(request.id!),
          parentId,
          kind: 'source',
          sourceId,
        });
      } else if (
        request.action === 'folder' ||
        request.action === 'project' ||
        request.action === 'note'
      )
        created = await api.create({
          name,
          parentId: request.id,
          kind: request.action === 'note' ? 'file' : request.action,
          text: request.text,
        });
      await useWorkspaceStore.getState().refresh();
      onClose();
      if (created) {
        if (created.kind === 'project') {
          // 导入的目录可能早先被「移除项目入口」隐藏过（同一目录只登记一次，加回来还是那一条）。
          unhideProjectInNav(created.id);
          onOpenProject?.(created.id);
        }
        onCreated?.(created);
      }
    } catch (error) {
      setModalError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={request !== null && !wizard}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-w-md')}>
          <Dialog.Title className="text-base font-semibold">
            {request ? (titles[request.action] ?? '') : ''}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-xs text-ink-3">
            {request?.action === 'connect'
              ? '使用个人 Access Token，凭据加密保存在本机。'
              : request?.action === 'remove'
                ? workspace.entries.find((entry) => entry.id === request.id)?.kind === 'project'
                  ? workspace.entries.find((entry) => entry.id === request.id)?.remoteId
                    ? '只取消登记，远端目录与文件不会改动，会话转入随聊。'
                    : '取消项目身份，目录与文件保留，会话转入随聊。'
                  : workspace.entries.find((entry) => entry.id === request.id)?.kind === 'source'
                    ? '解除此处的资料关联，原始资料保留。'
                    : '将文件或文件夹移至系统回收站。'
                : request?.action === 'link'
                  ? '在项目根目录引用资料，原位置保持不变。'
                  : request?.action === 'note'
                    ? '文件名原样使用，笔记请以 .md 结尾。'
                    : request?.action === 'project'
                      ? '新建空项目，或导入电脑上已有的文件夹。'
                      : '按自己的主题组织内容。'}
          </Dialog.Description>
          <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4">
            {(request?.action === 'link' || request?.action === 'move') && (
              <div className="grid gap-2 text-13">
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
                    {request.action === 'link' && (
                      <SelectItem value="__new__">新建项目…</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            {request &&
              !['move', 'remove'].includes(request.action) &&
              (request.action !== 'link' || target === '__new__') && (
                <label className="grid gap-2 text-13">
                  {request.action === 'connect' ? 'Access Token' : '名称'}
                  <Input
                    autoFocus
                    autoComplete="off"
                    type={request.action === 'connect' ? 'password' : 'text'}
                    aria-label={request.action === 'connect' ? 'Canvas Access Token' : '名称'}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
            {request?.action === 'project' && (
              <div className="grid gap-2">
                <div aria-hidden="true" className="flex items-center gap-3 text-xs">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-ink-3">或</span>
                  <span className="h-px flex-1 bg-border" />
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
                  连接远程目录
                </Button>
              </div>
            )}
            {modalError && (
              <p role="alert" className="text-xs [overflow-wrap:anywhere] text-red">
                {modalError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                取消
              </Button>
              <Button
                type="submit"
                disabled={busy || (request?.action === 'link' && !linkTarget)}
                variant={request?.action === 'remove' ? 'destructive' : undefined}
              >
                {busy
                  ? '处理中…'
                  : request?.action === 'remove'
                    ? '移除'
                    : request?.action === 'connect'
                      ? '连接'
                      : '确定'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
      {/* 向导有自己的对话框：外层弹窗打开它时关闭，取消后回到新建项目。 */}
      <RemoteConnectionWizard
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
    </Dialog.Root>
  );
}
