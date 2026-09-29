// 工作区 CRUD 弹窗（迁移自 ProjectView 的 modal 段）：新建项目/文件夹/笔记、重命名、
// 移动、移除、链接资料、连接 Canvas 共 8 种；表单状态与提交逻辑保持。
// 与旧实现的差别只在「成功之后」：旧 submit 直接操作编辑器布局（清理被删条目的标签、
// 打开新建的笔记），这里改为 onCreated/onRemoved/onOpenProject 回调，由接线方（3B
// workbench/导航）接手——弹窗只负责表单与 workspace:*/canvas:* 通道调用。
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type { WorkspaceEntry } from '../../shared/api';
import { useNoteDrafts } from './drafts';
import type { EntryAction } from './entry-actions';
import { errorText, useWorkspaceStore } from './store';

export interface EntryDialogRequest {
  action: EntryAction | 'link' | 'connect';
  id: string | null;
  /** note 弹窗的正文预填（来源 header 等）。 */
  text?: string;
  /** link/move 打开时预选的目标位置（旧 show() 里 currentContainer() 的取值）。 */
  initialTarget?: string;
}

const titles: Record<EntryDialogRequest['action'], string> = {
  folder: '新建文件夹',
  project: '新建项目',
  note: '新建笔记',
  rename: '重命名',
  move: '移动到',
  remove: '移除内容',
  promote: '作为项目开展',
  import: '导入本地文件',
  archive: '归档',
  link: '加入文件夹或项目',
  connect: '连接 Canvas',
};

/** 标签页与目录共用的条目标题解析（旧 ProjectView.title）。 */
export function titleOf(key: string): string {
  const { workspace, canvas } = useWorkspaceStore.getState();
  return (
    workspace.entries.find((e) => e.id === key)?.name ??
    canvas.items.find((i) => `source:${i.sourceId}` === key)?.name ??
    useNoteDrafts.getState().drafts[key]?.content.title ??
    '资料'
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
  /** 取消或成功提交后关闭；busy 期间不可关（旧 onOpenChange 行为）。 */
  onClose: () => void;
  /** create/link 成功后回调：打开新建笔记、展开父级等由接线方决定（旧 submit 尾段）。 */
  onCreated?: (entry: WorkspaceEntry) => void;
  /** remove 成功后回调仍存活的条目 id 集合；接线方据此清理标签与草稿、退出已删项目。 */
  onRemoved?: (liveIds: Set<string>) => void;
  /** 新建项目后打开（promote 的打开在 entry-actions.promoteEntry 回调）。 */
  onOpenProject?: (id: string) => void;
}) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // 旧 show()：打开时重置表单；rename 预填当前名，target 预选调用方给的位置。
  useEffect(() => {
    setName(
      request?.action === 'rename'
        ? (useWorkspaceStore.getState().workspace.entries.find((e) => e.id === request.id)?.name ??
            '')
        : '',
    );
    setTarget(request?.initialTarget ?? '');
    setModalError(null);
  }, [request]);

  const pathName = (entry: WorkspaceEntry): string => {
    const names = [entry.name];
    let parent = workspace.entries.find((e) => e.id === entry.parentId);
    while (parent) {
      names.unshift(parent.name);
      parent = workspace.entries.find((e) => e.id === parent!.parentId);
    }
    return names.join(' / ');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request || !window.dela) return;
    setBusy(true);
    setModalError(null);
    try {
      const api = window.dela.workspace;
      let created: WorkspaceEntry | undefined;
      if (request.action === 'connect') {
        await window.dela.canvas.configure(name);
        setName('');
        useWorkspaceStore.getState().setCanvas(await window.dela.canvas.syncCourses());
      } else if (request.action === 'rename') await api.update(request.id!, { name });
      else if (request.action === 'move')
        await api.update(request.id!, { parentId: target || null });
      else if (request.action === 'remove') {
        await api.remove(request.id!);
        const remaining = (await api.getState()).entries;
        onRemoved?.(new Set(remaining.map((e) => e.id)));
      } else if (request.action === 'link') {
        const sourceId = request.id!.startsWith('source:')
          ? request.id!.slice(7)
          : workspace.entries.find((e) => e.id === request.id)?.sourceId;
        if (!sourceId) throw new Error('请选择来源资料');
        let parentId = target || null;
        if (target === '__new__')
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
          kind: request.action,
          text: request.text,
        });
      await useWorkspaceStore.getState().refresh();
      onClose();
      if (created) {
        if (created.kind === 'project') onOpenProject?.(created.id);
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
      open={request !== null}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
          <Dialog.Title className="text-base font-semibold">
            {request ? titles[request.action] : ''}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-xs text-muted-foreground">
            {request?.action === 'connect'
              ? '使用个人 Access Token，凭据加密保存在本机。'
              : request?.action === 'remove'
                ? '移除该内容及其子项的应用内记录。本地文件和 Canvas 原件会保留。'
                : request?.action === 'link'
                  ? '引用同一份资料，原位置保持不变。'
                  : request?.action === 'note'
                    ? `笔记保存到 ${workspace.directory}`
                    : '按自己的主题组织内容。'}
          </Dialog.Description>
          <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4">
            {(request?.action === 'link' || request?.action === 'move') && (
              <label className="grid gap-2 text-sm">
                位置
                <select
                  aria-label="目标文件夹"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">我的内容</option>
                  {workspace.entries
                    .filter(
                      (e) => (e.kind === 'folder' || e.kind === 'project') && e.id !== request?.id,
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {pathName(e)}
                      </option>
                    ))}
                  {request.action === 'link' && <option value="__new__">新建项目…</option>}
                </select>
              </label>
            )}
            {request &&
              !['move', 'remove'].includes(request.action) &&
              (request.action !== 'link' || target === '__new__') && (
                <label className="grid gap-2 text-sm">
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
            {modalError && (
              <p role="alert" className="text-xs [overflow-wrap:anywhere] text-destructive">
                {modalError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
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
    </Dialog.Root>
  );
}
