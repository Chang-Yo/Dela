import { useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { errorText, useWorkspaceStore } from './store';
import { dialogOverlay, dialogPanel } from '../components/ui/motion';
import { cn } from '../lib/utils';

/** Radix Select 的 Item 不接受空串值，「我的内容」（根）用哨兵表示。 */
const ROOT_SELECT_VALUE = '__root__';

/**
 * 「添加到项目」对话框共享壳：位置选择（含新建项目）与 workspace source 条目创建，
 * 域差异（引用行写入、条目名、sourceId、描述文案）经 props 注入。
 */
export function AddToProjectDialogBase({
  open,
  onClose,
  description,
  subject,
  sourceId,
  writeRef,
}: {
  open: boolean;
  onClose: () => void;
  /** 对话框描述（引用「××」，……不变。）。 */
  description: string;
  /** source 条目名。 */
  subject: string;
  /** source 条目的来源标识（如 shuiyuan-topic:<id>）。 */
  sourceId: string;
  /** 写入来源引用行（域侧 IPC）；未就绪（如目标为 null）时提交被阻止。 */
  writeRef: (() => Promise<void>) | null;
}) {
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setErrorLocal] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !writeRef) return;
    setBusy(true);
    setErrorLocal(null);
    try {
      await writeRef();
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
        name: subject,
        parentId,
        kind: 'source',
        sourceId,
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
              <Dialog.Description className="mt-2 text-[12px] text-ink-3">
                {description}
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
            <label className="grid gap-2 text-[13px]">
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
              <label className="grid gap-2 text-[13px]">
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
            {error ? <p className="text-[12px] text-red">{error}</p> : null}
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
