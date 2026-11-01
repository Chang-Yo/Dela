import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prec } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
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
import { SHUIYUAN_ORIGIN, previewMarkdown, uploadMarkdown } from './shuiyuan-format';
import { SHUIYUAN_HOST } from '../../../shared/shuiyuan';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const PREVIEW_MEDIA_PREFIX = 'dela-resource://shuiyuan/';

const toolbarButton =
  'grid size-7 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink aria-pressed:bg-inset aria-pressed:font-medium aria-pressed:text-ink';

type UploadItem = { key: string; name: string; error: string | null };

/** 已上传附件 upload:// → 站点地址，预览据此显示真图；与内存草稿同为会话内有效。 */
const uploadedUrls = new Map<string, string>();

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

/** 同站图片走主进程带凭据的媒体代理，否则会被水源登录墙拦下。 */
function previewMediaUrl(url: string): string {
  const parsed = new URL(url, SHUIYUAN_ORIGIN);
  return parsed.hostname === SHUIYUAN_HOST
    ? `${PREVIEW_MEDIA_PREFIX}${parsed.pathname.slice(1)}${parsed.search}`
    : parsed.href;
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
  // 上传是异步的：value prop 在 await 期间不会更新，用链式副本接力最新正文。
  const valueRef = useRef(value);
  valueRef.current = value;
  /** 当前挂载的编辑器；预览态或切换全屏的间隙为 null，此时按纯文本追加。 */
  const viewRef = useRef<EditorView | null>(null);
  const uploadSeq = useRef(0);
  const uploading = uploads.some((item) => !item.error);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || uploading || !value.trim()) return;
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

  const currentText = () => viewRef.current?.state.sliceDoc() ?? valueRef.current;

  const setText = (next: string) => {
    valueRef.current = next;
    onChange(next);
  };

  /** 独占一行插入；at 缺省为光标处。 */
  const insertBlock = (text: string, at?: number) => {
    const view = viewRef.current;
    if (!view) {
      const current = valueRef.current;
      setText(`${current}${current && !current.endsWith('\n') ? '\n' : ''}${text}\n`);
      return;
    }
    const pos = at ?? view.state.selection.main.head;
    const before = view.state.sliceDoc(Math.max(0, pos - 1), pos);
    const insert = `${pos > 0 && before !== '\n' ? '\n' : ''}${text}\n`;
    view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
  };

  /** 占位已被用户删掉时视为放弃这次插入（与水源网页端一致）。 */
  const replacePlaceholder = (placeholder: string, text: string) => {
    const view = viewRef.current;
    if (view) {
      const at = view.state.sliceDoc().indexOf(placeholder);
      if (at >= 0)
        view.dispatch({ changes: { from: at, to: at + placeholder.length, insert: text } });
      return;
    }
    const current = valueRef.current;
    if (current.includes(placeholder)) setText(current.replace(placeholder, () => text));
  };

  // 先在落点写占位再串行上传：上传期间用户可以继续输入，附件仍落回原位置。
  const uploadFiles = async (files: readonly File[], at?: number) => {
    const api = window.dela?.shuiyuan;
    if (files.length === 0 || !api) return;
    const queued: { file: File; key: string; placeholder: string }[] = [];
    for (const file of files) {
      const key = `upload-${(uploadSeq.current += 1)}`;
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploads((current) => [...current, { key, name: file.name, error: '附件超过 20MB' }]);
        continue;
      }
      const label = file.name.replace(/[[\]\n]/g, ' ');
      let placeholder = `[上传中：${label}…]()`;
      for (let n = 2; currentText().includes(placeholder); n += 1) {
        placeholder = `[上传中：${label}（${n}）…]()`;
      }
      insertBlock(placeholder, queued.length === 0 ? at : undefined);
      setUploads((current) => [...current, { key, name: file.name, error: null }]);
      queued.push({ file, key, placeholder });
    }
    for (const { file, key, placeholder } of queued) {
      try {
        const upload = await api.uploadFile(file.name, await readAsBase64(file));
        if (upload.url) uploadedUrls.set(upload.shortUrl, upload.url);
        replacePlaceholder(placeholder, uploadMarkdown(file, upload));
      } catch (reason) {
        replacePlaceholder(placeholder, '');
        showToast({ variant: 'error', title: '附件上传失败', description: errorText(reason) });
      } finally {
        setUploads((current) => current.filter((item) => item.key !== key));
      }
    }
  };

  const uploadRef = useRef(uploadFiles);
  uploadRef.current = uploadFiles;
  // MarkdownEditor 只在挂载时装配扩展，内部回调一律经 ref 取最新闭包。
  const editorExtensions = useMemo(
    () => [
      // 回复里 Mod-s 不应等同发送（编辑器默认把它和 Mod-Enter 都接到 onSave）。
      Prec.highest(keymap.of([{ key: 'Mod-s', run: () => true }])),
      ViewPlugin.define((view) => {
        viewRef.current = view;
        return {
          destroy: () => {
            if (viewRef.current === view) viewRef.current = null;
          },
        };
      }),
      EditorView.domEventHandlers({
        paste: (event) => {
          const files = [...(event.clipboardData?.files ?? [])];
          if (files.length === 0) return false;
          event.preventDefault();
          void uploadRef.current(files);
          return true;
        },
        drop: (event, view) => {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (files.length === 0) return false;
          event.preventDefault();
          const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined;
          void uploadRef.current(files, at);
          return true;
        },
      }),
    ],
    [],
  );

  const previewSource = useMemo(
    () =>
      previewMarkdown(value, (shortUrl) => {
        const url = uploadedUrls.get(shortUrl);
        return url ? previewMediaUrl(url) : null;
      }),
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
            {item.error ? (
              <>
                <span className="text-red">{item.error}</span>
                <button
                  aria-label={`移除 ${item.name}`}
                  className="grid size-4 shrink-0 place-items-center rounded transition-colors hover:text-ink"
                  onClick={() => setUploads((current) => current.filter((u) => u.key !== item.key))}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </>
            ) : null}
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
      <Button
        disabled={busy || uploading || !value.trim()}
        size="sm"
        title={uploading ? '附件上传中' : undefined}
        type="submit"
      >
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
        extensions={editorExtensions}
        saveOnBlur={false}
        scroll={0}
        value={value}
      />
    </div>
  );

  const previewBody = (isMaximized: boolean) => (
    <div
      className={cn(
        'overflow-y-auto rounded-card border border-line bg-inset p-3 text-13 leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_code]:rounded-chip [&_code]:bg-hover-2 [&_code]:px-1 [&_code]:text-13 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-15 [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-hover-2 [&_pre]:p-3 [&_pre]:text-13 [&_ul]:list-disc [&_ul]:pl-5 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-control',
        isMaximized ? 'min-h-0 flex-1' : 'max-h-40',
      )}
    >
      {previewSource.trim() ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) =>
            url.startsWith(PREVIEW_MEDIA_PREFIX) ? url : defaultUrlTransform(url)
          }
        >
          {previewSource}
        </ReactMarkdown>
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
            onChange={(event) => {
              void uploadFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
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
          onChange={(event) => {
            void uploadFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
      </div>
    </form>
  );
}
