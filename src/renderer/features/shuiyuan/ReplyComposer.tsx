import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Prec } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import { FileWarning, Loader2, Maximize2, Minimize2, Paperclip, Send, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { sheetUp } from '../../components/ui/motion';
import { cn } from '../../lib/utils';
import { MarkdownEditor } from '../../content/note/MarkdownEditor';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { SHUIYUAN_ORIGIN, uploadMarkdown } from './shuiyuan-format';
import { shuiyuanReplyDecorations } from './reply-editor';
import { SHUIYUAN_HOST } from '../../../shared/shuiyuan';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type UploadItem = { key: string; name: string; error: string | null };

/** 已上传附件 upload:// → 站点地址，即时渲染据此显示真图；与内存草稿同为会话内有效。 */
const uploadedUrls = new Map<string, string>();

type ReplyComposerProps = {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => Promise<void>;
  onClose: () => void;
  placeholder: string;
  submitLabel: string;
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

/** 同站图片走主进程带凭据的媒体代理，否则会被水源登录墙拦下；音视频附件不按图片显示。 */
function previewImageUrl(src: string, alt: string): string | null {
  if (/\|(?:video|audio)$/.test(alt)) return null;
  const url = src.startsWith('upload://') ? uploadedUrls.get(src) : src;
  if (!url) return src;
  const parsed = new URL(url, SHUIYUAN_ORIGIN);
  return parsed.hostname === SHUIYUAN_HOST
    ? `dela-resource://shuiyuan/${parsed.pathname.slice(1)}${parsed.search}`
    : parsed.href;
}

/**
 * 水源回复卡片：从阅读区底部升起、不遮挡阅读（非模态），正文即时渲染。
 * 上传的附件以 upload:// 链接写回正文。
 */
export function ReplyComposer({
  value,
  onChange,
  onSubmit,
  onClose,
  placeholder,
  submitLabel,
  replyTarget,
  onClearReplyTarget,
}: ReplyComposerProps) {
  const [busy, setBusy] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const uploadSeq = useRef(0);
  const uploading = uploads.some((item) => !item.error);
  // 上传中不许收起：占位要靠编辑器视图替换回正文。
  const close = () => {
    if (!uploading) onClose();
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || uploading || !value.trim()) return;
    setBusy(true);
    try {
      await onSubmit();
    } catch (reason) {
      showToast({ variant: 'error', title: '回复发送失败', description: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  // 编辑器视图先于本组件 effect 建好；光标落到草稿末尾，接着上次写。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.contentDOM.focus({ preventScroll: true });
  }, []);

  /** 独占一行插入；at 缺省为光标处。 */
  const insertBlock = (view: EditorView, text: string, at?: number) => {
    const pos = at ?? view.state.selection.main.head;
    const before = view.state.sliceDoc(Math.max(0, pos - 1), pos);
    const insert = `${pos > 0 && before !== '\n' ? '\n' : ''}${text}\n`;
    view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
  };

  /** 占位已被用户删掉时视为放弃这次插入（与水源网页端一致）；离开帖子后视图已销毁则作罢。 */
  const replacePlaceholder = (placeholder: string, text: string) => {
    const view = viewRef.current;
    const at = view?.state.sliceDoc().indexOf(placeholder) ?? -1;
    if (view && at >= 0)
      view.dispatch({ changes: { from: at, to: at + placeholder.length, insert: text } });
  };

  // 先在落点写占位再串行上传：上传期间用户可以继续输入，附件仍落回原位置。
  const uploadFiles = async (files: readonly File[], at?: number) => {
    const api = window.dela?.shuiyuan;
    const view = viewRef.current;
    if (files.length === 0 || !api || !view) return;
    const queued: { file: File; key: string; placeholder: string }[] = [];
    for (const file of files) {
      const key = `upload-${(uploadSeq.current += 1)}`;
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploads((current) => [...current, { key, name: file.name, error: '附件超过 20MB' }]);
        continue;
      }
      const label = file.name.replace(/[[\]\n]/g, ' ');
      let placeholder = `[上传中：${label}…]()`;
      for (let n = 2; view.state.sliceDoc().includes(placeholder); n += 1) {
        placeholder = `[上传中：${label}（${n}）…]()`;
      }
      insertBlock(view, placeholder, queued.length === 0 ? at : undefined);
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
      shuiyuanReplyDecorations(),
    ],
    [],
  );

  return (
    // 留在布局流里而非浮层：阅读区随卡片升起让出高度，末楼不被压住；全屏时才铺满阅读区。
    <form
      aria-label="回复"
      className={cn(
        sheetUp,
        'z-30 mx-auto flex w-full max-w-2xl flex-col rounded-t-2xl bg-surface shadow-overlay',
        maximized ? 'absolute inset-x-0 top-3 bottom-0' : 'relative h-[min(22rem,50%)] shrink-0',
      )}
      onKeyDown={(event) => {
        // 编辑器先消费的 Esc（关闭搜索面板、收拢多选区）不再收起卡片。
        if (event.key === 'Escape' && !event.defaultPrevented) close();
      }}
      onSubmit={(e) => void submit(e)}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-5 max-md:pl-4">
        <span className="min-w-0 truncate text-13 font-medium tabular-nums">
          {replyTarget
            ? `回复 @${replyTarget.username} · 第 ${replyTarget.postNumber} 楼`
            : '回复帖子'}
        </span>
        {replyTarget ? (
          <button
            aria-label="改为回复帖子"
            className="grid size-5 shrink-0 place-items-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            onClick={onClearReplyTarget}
            title="改为回复帖子"
            type="button"
          >
            <X className="size-3" />
          </button>
        ) : null}
        <div className="flex-1" />
        <Button
          aria-label={maximized ? '退出全屏' : '全屏书写'}
          onClick={() => setMaximized(!maximized)}
          size="icon-sm"
          title={maximized ? '退出全屏' : '全屏书写'}
          variant="ghost"
        >
          {maximized ? (
            <Minimize2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
          ) : (
            <Maximize2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
          )}
        </Button>
        <Button
          aria-label="收起回复"
          disabled={uploading}
          onClick={close}
          size="icon-sm"
          title={uploading ? '附件上传中' : '收起（Esc），草稿保留'}
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" strokeWidth={1.8} />
        </Button>
      </div>
      {/* MarkdownEditor 的 flex-1 链依赖约束高度，内部 scroller 才会滚动。 */}
      <div className="flex min-h-0 flex-1 flex-col border-y border-line">
        <MarkdownEditor
          alwaysWrap
          ariaLabel="回复编辑器"
          extensions={editorExtensions}
          lineNumbers={false}
          livePreview={previewImageUrl}
          onChange={onChange}
          onSave={() => void submit()}
          onScroll={() => {}}
          placeholderText={placeholder}
          saveOnBlur={false}
          scroll={0}
          value={value}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Button
          aria-label="添加附件"
          onClick={() => fileInputRef.current?.click()}
          size="icon-sm"
          title="添加附件（也可粘贴或拖入）"
          variant="ghost"
        >
          <Paperclip aria-hidden="true" className="size-4" strokeWidth={1.8} />
        </Button>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {uploads.map((item) => (
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-control bg-inset px-2 py-1 text-xs text-ink-3"
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
                    onClick={() =>
                      setUploads((current) => current.filter((u) => u.key !== item.key))
                    }
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </>
              ) : null}
            </span>
          ))}
        </div>
        <Button
          disabled={busy || uploading || !value.trim()}
          size="sm"
          title={uploading ? '附件上传中' : 'Ctrl/⌘ + Enter 发送'}
          type="submit"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Send aria-hidden="true" className="size-4" />
          )}
          {busy ? '发送中…' : submitLabel}
        </Button>
      </div>
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
    </form>
  );
}
