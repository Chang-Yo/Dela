import { useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { errorText, useWorkspaceStore } from '../../workspace/store';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';

/** Radix Select 的 Item 不接受空串值，「我的内容」（根）用哨兵表示。 */
const ROOT_SELECT_VALUE = '__root__';

/** 建的是引用型 source 条目（sourceId 前缀 shuiyuan-topic:），正文仍实时读水源。 */
export function AddToProjectDialog({
  open,
  onClose,
  topicId,
  topicTitle,
}: {
  open: boolean;
  onClose: () => void;
  topicId: number | null;
  topicTitle: string;
}) {
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setErrorLocal] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || topicId === null) return;
    setBusy(true);
    setErrorLocal(null);
    try {
      await window.dela!.shuiyuan.addSourceRef(topicId);
      let parentId: string | null = target || null;
      if (target === '__new__') {
        if (!name.trim()) throw new Error('请填写项目名称');
        parentId = (
          await window.dela!.workspace.create({
            name: name.trim(),
            parentId: null,
            kind: 'project',
          })
        ).id;
      }
      await window.dela!.workspace.create({
        name: topicTitle,
        parentId,
        kind: 'source',
        sourceId: `shuiyuan-topic:${topicId}`,
      });
      await refresh();
      onClose();
      setTarget('');
      setName('');
    } catch (reason) {
      setErrorLocal(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const containers = entries.filter((entry) => entry.kind === 'folder' || entry.kind === 'project');

  return (
    <Dialog.Root onOpenChange={(next) => (next ? undefined : onClose())} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-md overflow-y-auto')}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">添加到项目</Dialog.Title>
              <Dialog.Description className="mt-2 text-xs text-ink-3">
                引用「{topicTitle || '该帖子'}」，原帖保持在水源不变。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="关闭"
                className="grid size-8 shrink-0 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                type="button"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>
          <form className="mt-4 grid gap-4" onSubmit={(event) => void submit(event)}>
            <label className="grid gap-2 text-13">
              位置
              <Select
                onValueChange={(value) => setTarget(value === ROOT_SELECT_VALUE ? '' : value)}
                value={target === '' ? ROOT_SELECT_VALUE : target}
              >
                <SelectTrigger aria-label="目标文件夹" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_SELECT_VALUE}>我的内容</SelectItem>
                  {containers.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__new__">新建项目…</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {target === '__new__' ? (
              <label className="grid gap-2 text-13">
                名称
                <Input
                  aria-label="新项目名称"
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </label>
            ) : null}
            {error ? <p className="text-xs text-red">{error}</p> : null}
            <div className="flex justify-end">
              <Button disabled={busy} type="submit">
                {busy ? '添加中…' : '添加'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
