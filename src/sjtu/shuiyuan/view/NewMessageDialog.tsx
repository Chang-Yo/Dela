import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { errorMessage } from '../../../core/protocol/contract';
import { MarkdownEditor } from '../../../modules/note/view';
import { showToast } from '../../../ui/toast';
import { openTopic } from './store';
import { shuiyuanClient } from './use-shuiyuan';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogHeader,
} from '../../../ui/dialog';
import { Field } from '../../../ui/field';

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
  const queryClient = useQueryClient();

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
      const topicId = await shuiyuanClient.message({
        to: recipients,
        title: title.trim(),
        raw: body,
      });
      setTo('');
      setTitle('');
      setBody('');
      onOpenChange(false);
      openTopic(topicId);
      void queryClient.invalidateQueries({ queryKey: ['shuiyuan', 'counts'] });
    } catch (reason) {
      showToast({ variant: 'error', title: '发送私信失败', description: errorMessage(reason) });
    }
    setBusy(false);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent size="lg" scroll>
        <DialogHeader>
          <DialogTitle>新私信</DialogTitle>
          <DialogClose />
        </DialogHeader>
        <DialogDescription>
          私信只发送给你填写的收件人，支持多个用户名（逗号分隔）。
        </DialogDescription>
        <form className="mt-4 grid gap-4" onSubmit={(event) => void submit(event)}>
          <Field label="收件人">
            <Input
              aria-label="收件人用户名"
              autoComplete="off"
              onChange={(event) => setTo(event.target.value)}
              placeholder="用户名，多个用逗号分隔"
              required
              value={to}
            />
          </Field>
          <Field label="标题">
            <Input
              aria-label="私信标题"
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </Field>
          <div className="grid gap-2 text-sm">
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
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button disabled={busy} type="submit">
              <Send className="size-4" />
              {busy ? '发送中…' : '发送'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
