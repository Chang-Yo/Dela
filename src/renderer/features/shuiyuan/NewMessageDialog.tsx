import { useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { Send, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { MarkdownEditor } from '../../content/note/MarkdownEditor';
import { errorText } from '../../workspace/store';
import { showToast } from '../../app/toasts';
import { useShuiyuan } from './store';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';

/** 发起新私信：收件人用户名（逗号分隔）+ 标题 + Markdown 正文。 */
export function NewMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [to, setTo] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openTopic = useShuiyuan((state) => state.openTopic);
  const refreshCounts = useShuiyuan((state) => state.refreshCounts);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const recipients = to
      .split(/[,，\s]+/)
      .map((name) => name.trim().replace(/^@/, ''))
      .filter(Boolean);
    if (recipients.length === 0 || !title.trim()) return;
    if (!body.trim()) return setError('请输入正文');
    setBusy(true);
    setError(null);
    try {
      const api = window.dela!.shuiyuan;
      const topicId = await api.createMessage(recipients, title.trim(), body);
      setTo('');
      setTitle('');
      setBody('');
      onOpenChange(false);
      void openTopic(topicId);
      void refreshCounts();
    } catch (reason) {
      showToast({ variant: 'error', title: '发送私信失败', description: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-lg overflow-y-auto')}>
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">新私信</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭"
                className="grid size-8 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                type="button"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs text-ink-3">
            私信只发送给你填写的收件人，支持多个用户名（逗号分隔）。
          </Dialog.Description>
          <form className="mt-4 grid gap-4" onSubmit={(event) => void submit(event)}>
            <label className="grid gap-2 text-13">
              收件人
              <Input
                aria-label="收件人用户名"
                autoComplete="off"
                onChange={(event) => setTo(event.target.value)}
                placeholder="用户名，多个用逗号分隔"
                required
                value={to}
              />
            </label>
            <label className="grid gap-2 text-13">
              标题
              <Input
                aria-label="私信标题"
                autoComplete="off"
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </label>
            <div className="grid gap-2 text-13">
              正文
              <div className="h-40 overflow-hidden rounded-control border border-line shadow-hairline">
                <MarkdownEditor
                  ariaLabel="私信正文编辑器"
                  lineNumbers={false}
                  onChange={setBody}
                  onSave={() => {}}
                  onScroll={() => {}}
                  placeholderText="写下内容…（Markdown）"
                  saveOnBlur={false}
                  scroll={0}
                  value={body}
                />
              </div>
            </div>
            {error ? <p className="text-xs text-red">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button disabled={busy} type="submit">
                <Send className="size-4" />
                {busy ? '发送中…' : '发送'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
