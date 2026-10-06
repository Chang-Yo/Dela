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

/** Radix Select 的 Item 不接受空串值，「我的内容」（根）用哨兵表示。 */
const ROOT_SELECT_VALUE = '__root__';

/**
 * 把当前帖子作为来源引用添加到项目/文件夹：先写 shuiyuan_topics 引用行，
 * 再建 workspace source 条目（sourceId 形如 shuiyuan-topic:<id>）。
 */
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
  const setError = useWorkspaceStore((state) => state.setError);
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
      const message = errorText(reason);
      setErrorLocal(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const containers = entries.filter((entry) => entry.kind === 'folder' || entry.kind === 'project');

  return (
    <Dialog.Root onOpenChange={(next) => (next ? undefined : onClose())} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">添加到项目</Dialog.Title>
              <Dialog.Description className="mt-2 text-xs text-muted-foreground">
                引用「{topicTitle || '该帖子'}」，原帖保持在水源不变。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="关闭"
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                type="button"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>
          <form className="mt-4 grid gap-4" onSubmit={(event) => void submit(event)}>
            <label className="grid gap-2 text-sm">
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
              <label className="grid gap-2 text-sm">
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
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
