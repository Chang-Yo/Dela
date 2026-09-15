import { useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CornerUpLeft, Eye, PenLine, Send } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { MarkdownEditor } from '../projects/MarkdownEditor';
import { errorText } from '../projects/workspace';

const previewClasses =
  'max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[13px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-[13px] [&_ul]:list-disc [&_ul]:pl-5';

type ReplyComposerProps = {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => Promise<void>;
  onExpandedChange: (expanded: boolean) => void;
  expanded: boolean;
  placeholder: string;
  submitLabel: string;
  /** 帖子关闭/归档等不可回复情形的提示；非空时输入区只读。 */
  disabledHint: string | null;
};

/** 底部回复器：折叠时是输入框样式的按钮，展开为 Markdown 编辑 + 预览 + 发送。 */
export function ReplyComposer({
  value,
  onChange,
  onSubmit,
  onExpandedChange,
  expanded,
  placeholder,
  submitLabel,
  disabledHint,
}: ReplyComposerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  if (disabledHint) {
    return (
      <div className="border-t bg-background px-4 py-3 max-md:px-3">
        <p className="mx-auto max-w-3xl text-center text-xs text-muted-foreground">
          {disabledHint}
        </p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="border-t bg-background px-4 py-3 max-md:px-3">
        <button
          className="mx-auto flex h-9 w-full max-w-3xl items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent/50"
          onClick={() => onExpandedChange(true)}
          type="button"
        >
          <PenLine className="size-4" />
          {placeholder}
        </button>
      </div>
    );
  }

  return (
    <form className="border-t bg-background px-4 py-3 max-md:px-3" onSubmit={(e) => void submit(e)}>
      <div className="mx-auto grid w-full max-w-3xl gap-2">
        {preview ? (
          <div className={previewClasses}>
            {value.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
            ) : (
              <p className="text-muted-foreground">暂无内容</p>
            )}
          </div>
        ) : (
          <div className="h-44 overflow-hidden rounded-md border shadow-xs">
            <MarkdownEditor
              ariaLabel="回复编辑器"
              lineNumbers={false}
              onChange={onChange}
              onSave={() => void submit()}
              onScroll={() => {}}
              placeholderText={placeholder}
              scroll={0}
              value={value}
            />
          </div>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex items-center gap-2">
          <Button disabled={busy || !value.trim()} type="submit">
            <Send className="size-4" />
            {busy ? '发送中…' : submitLabel}
          </Button>
          <Button
            aria-pressed={preview}
            onClick={() => setPreview(!preview)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Eye className="size-4" />
            {preview ? '编辑' : '预览'}
          </Button>
          <div className="flex-1" />
          <Button
            onClick={() => {
              onExpandedChange(false);
              setPreview(false);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <CornerUpLeft className="size-4" />
            收起
          </Button>
        </div>
      </div>
    </form>
  );
}
