import { useMemo, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Eye,
  FileWarning,
  Loader2,
  Lock,
  Paperclip,
  PanelRightClose,
  PenLine,
  Reply,
  Send,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { MarkdownEditor } from '../projects/MarkdownEditor';
import { errorText } from '../projects/workspace';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const toolbarButton =
  'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground';

type UploadItem = { key: string; name: string; error: string | null };

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
  /**
   * docked：宽屏阅读页右侧停靠栏，按需展开、编辑器撑满；
   * floating：窄屏底部折叠条，展开为卡片。
   */
  variant: 'docked' | 'floating';
  /** 楼层级回复目标；非空时在编辑器上方展示目标准条。 */
  replyTarget: { postNumber: number; username: string } | null;
  onClearReplyTarget: () => void;
  /** docked 收起回复栏回调（保留草稿）；floating 不使用。 */
  onCollapse?: () => void;
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(Math.max(0, result.indexOf(',') + 1)));
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 水源回复器：Markdown 编辑 + 预览 + 附件上传（upload:// 链接写回正文）。 */
export function ReplyComposer({
  value,
  onChange,
  onSubmit,
  onExpandedChange,
  expanded,
  placeholder,
  submitLabel,
  disabledHint,
  variant,
  replyTarget,
  onClearReplyTarget,
  onCollapse,
}: ReplyComposerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 一次选中多个文件时串行追加；value prop 在循环内不会即时更新，用链式副本接力。
  const valueRef = useRef(value);
  valueRef.current = value;

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

  const uploadFiles = async (files: FileList | null) => {
    const api = window.dela?.shuiyuan;
    if (!files || files.length === 0 || !api) return;
    for (const [index, file] of Array.from(files).entries()) {
      const key = `${file.name}-${uploads.length}-${index}-${file.lastModified}-${file.size}`;
      setUploads((current) => [...current, { key, name: file.name, error: null }]);
      try {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error('附件超过 20MB');
        const base64 = await readAsBase64(file);
        const upload = await api.uploadFile(file.name, base64);
        setUploads((current) => current.filter((item) => item.key !== key));
        const isImage =
          file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name);
        const markdown = isImage
          ? `![${file.name}](${upload.shortUrl})`
          : `[${file.name}](${upload.shortUrl})`;
        const current = valueRef.current;
        const next = current ? `${current}\n${markdown}\n` : `${markdown}\n`;
        valueRef.current = next;
        onChange(next);
      } catch (reason) {
        setUploads((current) =>
          current.map((item) => (item.key === key ? { ...item, error: errorText(reason) } : item)),
        );
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 预览无法解析 upload:// 协议，替换为可读占位。
  const previewSource = useMemo(
    () =>
      value
        .replace(/!\[([^\]]*)\]\(upload:\/\/[^)]*\)/g, '`附件：$1`')
        .replace(/\[([^\]]*)\]\(upload:\/\/[^)]*\)/g, '$1（附件）'),
    [value],
  );

  const uploadChips =
    uploads.length > 0 ? (
      <div className="flex flex-wrap gap-1.5">
        {uploads.map((item) => (
          <span
            className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
            key={item.key}
          >
            {item.error ? (
              <FileWarning aria-hidden="true" className="size-3.5 shrink-0 text-destructive" />
            ) : (
              <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
            )}
            <span className="max-w-44 truncate">{item.name}</span>
            {item.error ? <span className="text-destructive">{item.error}</span> : null}
            <button
              aria-label={`移除 ${item.name}`}
              className="grid size-4 shrink-0 place-items-center rounded transition-colors hover:text-foreground"
              onClick={() => setUploads((current) => current.filter((u) => u.key !== item.key))}
              type="button"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    ) : null;

  // 楼层级回复目标准条：X 清除后回到主题级回复。
  const replyTargetBanner = replyTarget ? (
    <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
      <Reply aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 truncate tabular-nums">
        回复 @{replyTarget.username} · 第 {replyTarget.postNumber} 楼
      </span>
      <button
        aria-label="取消回复该楼层"
        className="ml-auto grid size-4 shrink-0 place-items-center rounded transition-colors hover:text-foreground"
        onClick={onClearReplyTarget}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  ) : null;

  const collapseButton = (
    <Button
      aria-label="收起回复栏"
      onClick={() => onCollapse?.()}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <PanelRightClose aria-hidden="true" className="size-4" strokeWidth={1.8} />
    </Button>
  );

  const toolbar = (
    <div className="flex items-center gap-1">
      <button
        aria-label="添加附件"
        className={toolbarButton}
        onClick={() => fileInputRef.current?.click()}
        title="添加附件"
        type="button"
      >
        <Paperclip className="size-4" strokeWidth={1.8} />
      </button>
      <button
        aria-label={preview ? '回到编辑' : '预览'}
        aria-pressed={preview}
        className={toolbarButton}
        onClick={() => setPreview(!preview)}
        title={preview ? '编辑' : '预览'}
        type="button"
      >
        {preview ? (
          <PenLine className="size-4" strokeWidth={1.8} />
        ) : (
          <Eye className="size-4" strokeWidth={1.8} />
        )}
      </button>
      <div className="flex-1" />
      {variant === 'docked' ? collapseButton : null}
      {variant === 'floating' ? (
        <Button
          onClick={() => {
            onExpandedChange(false);
            setPreview(false);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          收起
        </Button>
      ) : null}
      <Button disabled={busy || !value.trim()} size="sm" type="submit">
        {busy ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        {busy ? '发送中…' : submitLabel}
      </Button>
    </div>
  );

  const errorLine = error ? <p className="text-xs text-destructive">{error}</p> : null;

  const previewBody = (fill: boolean) => (
    <div
      className={
        fill
          ? 'min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[13px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-[13px] [&_ul]:list-disc [&_ul]:pl-5'
          : 'max-h-40 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[13px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-[13px] [&_ul]:list-disc [&_ul]:pl-5'
      }
    >
      {previewSource.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewSource}</ReactMarkdown>
      ) : (
        <p className="text-muted-foreground">暂无内容</p>
      )}
    </div>
  );

  if (disabledHint) {
    if (variant === 'docked') {
      return (
        <aside className="flex min-h-0 flex-1 flex-col border-l bg-background">
          {/* 不可回复时也保留收起入口，避免楼层按钮展开后无处关闭。 */}
          <div className="flex justify-end px-3 pt-3">{collapseButton}</div>
          <div className="grid flex-1 place-items-center px-6">
            <p className="flex items-center gap-2 text-center text-xs text-muted-foreground">
              <Lock aria-hidden="true" className="size-3.5" />
              {disabledHint}
            </p>
          </div>
        </aside>
      );
    }
    return (
      <div className="border-t bg-background px-4 py-3 max-md:px-3">
        <p className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <Lock aria-hidden="true" className="size-3.5" />
          {disabledHint}
        </p>
      </div>
    );
  }

  if (variant === 'docked') {
    return (
      <aside className="flex min-h-0 flex-1 flex-col border-l bg-background">
        <form
          className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3 pt-3"
          onSubmit={(e) => void submit(e)}
        >
          {replyTargetBanner}
          {preview ? (
            previewBody(true)
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border shadow-xs transition-colors focus-within:border-ring/60">
              <MarkdownEditor
                ariaLabel="回复编辑器"
                lineNumbers={false}
                onChange={onChange}
                onSave={() => void submit()}
                onScroll={() => {}}
                placeholderText={placeholder}
                saveOnBlur={false}
                scroll={0}
                value={value}
              />
            </div>
          )}
          {uploadChips}
          {errorLine}
          {toolbar}
          <input
            aria-hidden="true"
            className="hidden"
            multiple
            onChange={(event) => void uploadFiles(event.target.files)}
            ref={fileInputRef}
            tabIndex={-1}
            type="file"
          />
        </form>
      </aside>
    );
  }

  if (!expanded) {
    return (
      <div className="border-t bg-background px-4 py-3 max-md:px-3">
        <button
          className="mx-auto flex h-9 w-full max-w-3xl items-center gap-2 rounded-xl border border-input bg-background px-3 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent/50"
          onClick={() => onExpandedChange(true)}
          type="button"
        >
          <PenLine className="size-4" strokeWidth={1.8} />
          {placeholder}
        </button>
      </div>
    );
  }

  return (
    <form className="border-t bg-background px-4 py-3 max-md:px-3" onSubmit={(e) => void submit(e)}>
      <div className="mx-auto grid w-full max-w-3xl gap-2">
        {replyTargetBanner}
        {preview ? (
          previewBody(false)
        ) : (
          <div className="h-44 overflow-hidden rounded-lg border shadow-xs">
            <MarkdownEditor
              ariaLabel="回复编辑器"
              lineNumbers={false}
              onChange={onChange}
              onSave={() => void submit()}
              onScroll={() => {}}
              placeholderText={placeholder}
              saveOnBlur={false}
              scroll={0}
              value={value}
            />
          </div>
        )}
        {uploadChips}
        {errorLine}
        {toolbar}
        <input
          aria-hidden="true"
          className="hidden"
          multiple
          onChange={(event) => void uploadFiles(event.target.files)}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
      </div>
    </form>
  );
}
