import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Eye,
  FileWarning,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Paperclip,
  PenLine,
  Reply,
  Send,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { MarkdownEditor } from '../../content/note/MarkdownEditor';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const toolbarButton =
  'grid size-7 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink aria-pressed:bg-inset aria-pressed:font-medium aria-pressed:text-ink';

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
  /** 楼层级回复目标。 */
  replyTarget: { postNumber: number; username: string } | null;
  onClearReplyTarget: () => void;
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

/** 水源回复器：上传的附件以 upload:// 链接写回正文。 */
export function ReplyComposer({
  value,
  onChange,
  onSubmit,
  onExpandedChange,
  expanded,
  placeholder,
  submitLabel,
  disabledHint,
  replyTarget,
  onClearReplyTarget,
}: ReplyComposerProps) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 一次选中多个文件时串行追加；value prop 在循环内不会即时更新，用链式副本接力。
  const valueRef = useRef(value);
  valueRef.current = value;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !value.trim()) return;
    setBusy(true);
    try {
      await onSubmit();
      setMaximized(false);
    } catch (reason) {
      showToast({ variant: 'error', title: '回复发送失败', description: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  // 挂在 window 上，焦点在编辑器内时 Esc 也能退出全屏。
  useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMaximized(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maximized]);

  const uploadFiles = async (files: FileList | null) => {
    const api = window.dela?.shuiyuan;
    if (!files || files.length === 0 || !api) return;
    for (const [index, file] of Array.from(files).entries()) {
      const key = `${file.name}-${uploads.length}-${index}-${file.lastModified}-${file.size}`;
      setUploads((current) => [...current, { key, name: file.name, error: null }]);
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploads((current) =>
          current.map((item) => (item.key === key ? { ...item, error: '附件超过 20MB' } : item)),
        );
        continue;
      }
      try {
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
        setUploads((current) => current.filter((item) => item.key !== key));
        showToast({ variant: 'error', title: '附件上传失败', description: errorText(reason) });
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
            className="flex max-w-full items-center gap-1.5 rounded-control border border-line bg-inset px-2 py-1 text-xs text-ink-3"
            key={item.key}
          >
            {item.error ? (
              <FileWarning aria-hidden="true" className="size-3.5 shrink-0 text-red" />
            ) : (
              <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
            )}
            <span className="max-w-44 truncate">{item.name}</span>
            {item.error ? <span className="text-red">{item.error}</span> : null}
            <button
              aria-label={`移除 ${item.name}`}
              className="grid size-4 shrink-0 place-items-center rounded transition-colors hover:text-ink"
              onClick={() => setUploads((current) => current.filter((u) => u.key !== item.key))}
              type="button"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    ) : null;

  // X 清除目标准条后回到主题级回复。
  const replyTargetBanner = replyTarget ? (
    <div className="flex shrink-0 items-center gap-1.5 rounded-control bg-inset px-2 py-1 text-xs text-ink-3">
      <Reply aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 truncate tabular-nums">
        回复 @{replyTarget.username} · 第 {replyTarget.postNumber} 楼
      </span>
      <button
        aria-label="取消回复该楼层"
        className="ml-auto grid size-4 shrink-0 place-items-center rounded transition-colors hover:text-ink"
        onClick={onClearReplyTarget}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  ) : null;

  // 窗口钮组悬在编辑/预览卡片角上，不占工具栏位置。
  const windowButtons = (isMaximized: boolean) => (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
      <Button
        aria-label={isMaximized ? '退出全屏' : '全屏书写'}
        className="bg-surface/90 shadow-hairline hover:bg-hover"
        onClick={() => setMaximized(!isMaximized)}
        size="icon-sm"
        title={isMaximized ? '退出全屏' : '全屏书写'}
        type="button"
        variant="ghost"
      >
        {isMaximized ? (
          <Minimize2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
        ) : (
          <Maximize2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
        )}
      </Button>
      <Button
        aria-label="收起回复框"
        className="bg-surface/90 shadow-hairline hover:bg-hover"
        onClick={() => {
          onExpandedChange(false);
          setPreview(false);
          setMaximized(false);
        }}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <X aria-hidden="true" className="size-4" strokeWidth={1.8} />
      </Button>
    </div>
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

  // 编辑壳必须是 flex 列：MarkdownEditor 的 flex-1 链依赖约束高度，内部 scroller 才会滚动。
  const editorHost = (shellClass: string) => (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-card border border-line shadow-hairline',
        shellClass,
      )}
    >
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
  );

  const previewBody = (isMaximized: boolean) => (
    <div
      className={cn(
        'overflow-y-auto rounded-card border border-line bg-inset p-3 text-13 leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_code]:rounded-chip [&_code]:bg-hover-2 [&_code]:px-1 [&_code]:text-13 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-15 [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-hover-2 [&_pre]:p-3 [&_pre]:text-13 [&_ul]:list-disc [&_ul]:pl-5',
        isMaximized ? 'min-h-0 flex-1' : 'max-h-40',
      )}
    >
      {previewSource.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewSource}</ReactMarkdown>
      ) : (
        <p className="text-ink-3">暂无内容</p>
      )}
    </div>
  );

  // 绝对定位铺满阅读区：TopicReader 根必须 relative 作锚点，编辑器吃满剩余高度。
  if (maximized) {
    return (
      <form
        className="absolute inset-0 z-30 flex flex-col bg-surface"
        onSubmit={(e) => void submit(e)}
      >
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2 px-4 py-4 max-md:px-3">
          {replyTargetBanner}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {windowButtons(true)}
            {preview ? previewBody(true) : editorHost('min-h-0 flex-1')}
          </div>
          {uploadChips}
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

  if (disabledHint) {
    return (
      <div className="border-t bg-surface px-4 py-3 max-md:px-3">
        <p className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-center text-xs text-ink-3">
          <Lock aria-hidden="true" className="size-3.5" />
          {disabledHint}
        </p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="border-t bg-surface px-4 py-3 max-md:px-3">
        <button
          className="mx-auto flex h-10 w-full max-w-3xl items-center gap-2 rounded-card border border-line-strong bg-surface px-3.5 text-left text-13 text-ink-3 shadow-hairline transition-colors hover:border-ink-3 hover:bg-hover"
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
    <form className="border-t bg-surface px-4 py-3 max-md:px-3" onSubmit={(e) => void submit(e)}>
      <div className="mx-auto grid w-full max-w-3xl gap-2">
        {replyTargetBanner}
        <div className="relative">
          {windowButtons(false)}
          {preview ? previewBody(false) : editorHost('h-44')}
        </div>
        {uploadChips}
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
