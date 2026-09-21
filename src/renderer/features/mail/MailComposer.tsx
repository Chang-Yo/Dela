import {
  Bold,
  ImagePlus,
  Italic,
  Link,
  LoaderCircle,
  Paperclip,
  Send,
  Save,
  X,
} from 'lucide-react';
import { registerComposeClose, leaveComposer } from './compose-close';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { MailComposeFile, PreparedEmail } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { formatSize } from './mail-format';

type Props = {
  draft?: PreparedEmail;
  accountAddress: string;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSent: (warning?: string) => void;
  /** 邮箱 grid 的占位类,由 MailView 按布局档位传入;Dialog 等非网格场景无需传。 */
  className?: string;
};

const toolButtonClass =
  'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground disabled:pointer-events-none disabled:opacity-40';

function restoreSelection(editor: HTMLDivElement, range: Range | null): void {
  editor.focus();
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  if (range && editor.contains(range.commonAncestorContainer)) {
    selection.addRange(range);
    return;
  }
  const fallback = document.createRange();
  fallback.selectNodeContents(editor);
  fallback.collapse(false);
  selection.addRange(fallback);
}

function hasEditableSelection(editor: HTMLDivElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) && !range.collapsed;
}

function normalizeLink(value: string): string | null {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function serializeBody(editor: HTMLDivElement): { html: string; text: string } {
  const clone = editor.cloneNode(true) as HTMLDivElement;
  for (const element of clone.querySelectorAll('*')) {
    if (element instanceof HTMLAnchorElement) {
      const href = normalizeLink(element.getAttribute('href') ?? '');
      if (!href) {
        element.replaceWith(...element.childNodes);
        continue;
      }
      for (const attribute of Array.from(element.attributes))
        element.removeAttribute(attribute.name);
      element.href = href;
      element.target = '_blank';
      element.rel = 'noreferrer';
      continue;
    }
    if (element instanceof HTMLImageElement) {
      const id = element.dataset.delaInline;
      if (!id) {
        element.remove();
        continue;
      }
      const alt = element.alt;
      for (const attribute of Array.from(element.attributes))
        element.removeAttribute(attribute.name);
      element.src = `cid:${id}@dela`;
      element.alt = alt;
      continue;
    }
    if (!['DIV', 'P', 'BR', 'STRONG', 'B', 'EM', 'I'].includes(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  }
  const plainText = clone.cloneNode(true) as HTMLDivElement;
  for (const link of plainText.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (href) link.append(` [${href}]`);
  }
  return { html: clone.innerHTML, text: plainText.innerText };
}

export function MailComposer({
  accountAddress,
  onClose,
  onDirtyChange,
  onSent,
  draft,
  className,
}: Props) {
  const dela = window.dela!;
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const filesRef = useRef<MailComposeFile[]>([]);
  const [to, setTo] = useState(draft?.recipientText ?? draft?.to.join(', ') ?? '');
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [bodyHasContent, setBodyHasContent] = useState(Boolean(draft?.text));
  const [files, setFiles] = useState<MailComposeFile[]>(draft?.files ?? []);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingDraft = useRef(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const savedId = useRef(draft?.savedLocally ? draft.id : undefined);
  const savedContent = useRef('');
  const allowUnload = useRef(false);
  const latestClose = useRef<() => Promise<boolean>>(async () => true);
  const releaseTimerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formatState, setFormatState] = useState({ bold: false, italic: false });
  const [hasLinkSelection, setHasLinkSelection] = useState(false);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);

  filesRef.current = files;
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const dirty = Boolean(
    to.trim() || subject.trim() || bodyHasContent || files.length || savedId.current,
  );

  const snapshot = () => {
    const body = editorRef.current ? serializeBody(editorRef.current) : { text: '', html: '' };
    return {
      account: accountAddress,
      recipientText: to,
      subject,
      ...body,
      attachmentIds: files.filter((file) => file.kind === 'attachment').map((file) => file.id),
      inlineImageIds: files.filter((file) => file.kind === 'inline').map((file) => file.id),
    };
  };
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!draft || !editor) return;
    if (!draft.html) {
      editor.textContent = draft.text;
      if (draft.savedLocally) savedContent.current = JSON.stringify(snapshot());
      return;
    }
    // Reconstruct a small safe formatting subset; never insert stored HTML directly.
    const parsed = new DOMParser().parseFromString(draft.html, 'text/html');
    const append = (source: Node, target: Node) => {
      if (source.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(source.textContent ?? ''));
        return;
      }
      if (!(source instanceof Element)) return;
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(source.tagName)) return;
      if (source.tagName === 'IMG') {
        const file = draft.files.find(
          (file) => source.getAttribute('src') === `cid:${file.id}@dela` && file.kind === 'inline',
        );
        if (file?.previewUrl) {
          const image = document.createElement('img');
          image.src = file.previewUrl;
          image.dataset.delaInline = file.id;
          image.alt = source.getAttribute('alt') ?? '';
          target.appendChild(image);
        }
        return;
      }
      let destination = target;
      if (['DIV', 'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'A'].includes(source.tagName)) {
        const element = document.createElement(source.tagName.toLowerCase());
        if (element instanceof HTMLAnchorElement) {
          const href = normalizeLink(source.getAttribute('href') ?? '');
          if (href) element.href = href;
        }
        target.appendChild(element);
        destination = element;
      }
      for (const child of source.childNodes) append(child, destination);
    };
    editor.replaceChildren();
    for (const child of parsed.body.childNodes) append(child, editor);
    if (draft.savedLocally) savedContent.current = JSON.stringify(snapshot());
  }, [draft]);

  const saveDraft = async () => {
    if (sending || savingDraft.current) return false;
    savingDraft.current = true;
    setSaving(true);
    setError(null);
    try {
      const content = snapshot();
      const result = await dela.mail.saveDraft({ ...content, id: savedId.current });
      savedId.current = result.id;
      savedContent.current = JSON.stringify(content);
      setSavedNotice(true);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      savingDraft.current = false;
      setSaving(false);
    }
  };
  latestClose.current = async () => {
    if (sending || saving) return false;
    if (!dirty || JSON.stringify(snapshot()) === savedContent.current) return true;
    try {
      const choice = await dela.mail.confirmDraftClose();
      if (choice === 'cancel') return false;
      return choice === 'discard' || (await saveDraft());
    } catch (reason) {
      setError(String(reason));
      return false;
    }
  };
  useEffect(() => registerComposeClose(() => latestClose.current()), []);
  useEffect(() => {
    void dela.mail.setComposeActive(true);
    const unsubscribe = dela.mail.onRequestClose(() => {
      if (
        !leaveComposer(() => {
          allowUnload.current = true;
          void dela.mail.setComposeActive(false).then(() => dela.window.close());
        })
      )
        return;
      allowUnload.current = true;
      void dela.mail.setComposeActive(false).then(() => dela.window.close());
    });
    return () => {
      unsubscribe();
      void dela.mail.setComposeActive(false);
    };
  }, [dela]);

  useEffect(() => {
    const updateLinkSelection = () => {
      const editor = editorRef.current;
      setHasLinkSelection(Boolean(editor && hasEditableSelection(editor)));
    };
    document.addEventListener('selectionchange', updateLinkSelection);
    return () => document.removeEventListener('selectionchange', updateLinkSelection);
  }, []);

  useEffect(() => {
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || allowUnload.current) return;
      event.preventDefault();
      event.returnValue = false;
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  // 暂存附件的释放:主进程仅在发送成功后释放,保存/删除/丢弃草稿都依赖卸载时释放。
  // 开发模式 StrictMode 挂载后立刻假卸载一次,同步释放会让重挂载后的保存/发送报
  // 「所选文件已失效」,故推迟一个宏任务:假卸载被重挂载取消,真卸载照常全量释放。
  useEffect(() => {
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    return () => {
      const ids = filesRef.current.map((file) => file.id);
      if (ids.length) {
        releaseTimerRef.current = window.setTimeout(() => {
          releaseTimerRef.current = null;
          void dela.mail.releaseComposeFiles(ids);
        }, 0);
      }
      dirtyCallback.current(false);
    };
  }, [dela.mail]);

  const attachments = files.filter((file) => file.kind === 'attachment');

  const syncFormatState = () => {
    try {
      setFormatState({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
      });
    } catch {
      /* 环境不支持 queryCommandState 时忽略。 */
    }
  };

  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      selectionRef.current = range.cloneRange();
      setHasLinkSelection(!range.collapsed);
    } else {
      setHasLinkSelection(false);
    }
    syncFormatState();
  };

  const format = (command: 'bold' | 'italic') => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection(editor, selectionRef.current);
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command);
    saveSelection();
  };

  const openLinkDraft = () => {
    const editor = editorRef.current;
    if (!editor || !hasEditableSelection(editor)) return;
    saveSelection();
    setLinkInvalid(false);
    setLinkDraft('');
  };

  const applyLink = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const href = normalizeLink(linkDraft?.trim() ?? '');
    if (!href) {
      setLinkInvalid(true);
      return;
    }
    restoreSelection(editor, selectionRef.current);
    document.execCommand('createLink', false, href);
    setLinkDraft(null);
    editor.focus();
    handleEditorInput();
  };

  const cancelLink = () => {
    setLinkDraft(null);
    const editor = editorRef.current;
    if (editor) restoreSelection(editor, selectionRef.current);
  };

  const pickFiles = async (kind: 'attachment' | 'inline') => {
    const editor = editorRef.current;
    if (editor) saveSelection();
    const picked = [...(await dela.mail.pickComposeFiles(kind))];
    if (!picked.length) return;
    setFiles((current) => [...current, ...picked]);
    if (kind === 'inline' && editor) {
      restoreSelection(editor, selectionRef.current);
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      for (const file of picked) {
        if (!file.previewUrl || !range) continue;
        const image = document.createElement('img');
        image.src = file.previewUrl;
        image.alt = file.name;
        image.dataset.delaInline = file.id;
        range.insertNode(image);
        range.setStartAfter(image);
        range.collapse(true);
      }
      saveSelection();
      setBodyHasContent(true);
    }
  };

  const pasteImage = (event: ClipboardEvent<HTMLDivElement>) => {
    const image = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'));
    if (!image) return false;
    const file = image.getAsFile();
    if (!file) return false;
    event.preventDefault();
    saveSelection();
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return;
      void dela.mail
        .addComposeImage(reader.result)
        .then((picked) => {
          const editor = editorRef.current;
          if (!editor) return;
          setFiles((current) => [...current, picked]);
          restoreSelection(editor, selectionRef.current);
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          if (!picked.previewUrl || !range) return;
          const imageElement = document.createElement('img');
          imageElement.src = picked.previewUrl;
          imageElement.alt = picked.name;
          imageElement.dataset.delaInline = picked.id;
          range.insertNode(imageElement);
          range.setStartAfter(imageElement);
          range.collapse(true);
          saveSelection();
          setBodyHasContent(true);
        })
        .catch((pasteError) => {
          setError(pasteError instanceof Error ? pasteError.message : String(pasteError));
        });
    });
    reader.readAsDataURL(file);
    return true;
  };

  const removeFile = (id: string) => {
    const editor = editorRef.current;
    editor?.querySelector(`img[data-dela-inline="${CSS.escape(id)}"]`)?.remove();
    setFiles((current) => current.filter((file) => file.id !== id));
    void dela.mail.releaseComposeFiles([id]);
    setBodyHasContent(
      Boolean(editor?.innerText.trim()) || Boolean(editor?.querySelector('img[data-dela-inline]')),
    );
  };

  const pastePlainText = (event: ClipboardEvent<HTMLDivElement>) => {
    if (pasteImage(event)) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  };

  const handleEditorInput = () => {
    const activeInlineIds = new Set(
      [...(editorRef.current?.querySelectorAll<HTMLImageElement>('img[data-dela-inline]') ?? [])]
        .map((image) => image.dataset.delaInline)
        .filter((id): id is string => Boolean(id)),
    );
    setFiles((current) => {
      const removed = current.filter(
        (file) => file.kind === 'inline' && !activeInlineIds.has(file.id),
      );
      if (removed.length) void dela.mail.releaseComposeFiles(removed.map((file) => file.id));
      return removed.length
        ? current.filter((file) => file.kind !== 'inline' || activeInlineIds.has(file.id))
        : current;
    });
    setBodyHasContent(
      Boolean(editorRef.current?.innerText.trim()) ||
        Boolean(editorRef.current?.querySelector('img[data-dela-inline]')),
    );
    syncFormatState();
    saveSelection();
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      format('bold');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      format('italic');
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'k' &&
      editor &&
      hasEditableSelection(editor)
    ) {
      event.preventDefault();
      openLinkDraft();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const recipients = to
      .split(/[\s,;，；]+/)
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean);
    if (!recipients.length) {
      setError('请输入收件人');
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    setSending(true);
    setError(null);
    try {
      const body = serializeBody(editor);
      const result = await dela.mail.sendMessage({
        to: recipients,
        subject,
        text: body.text,
        html: body.html,
        attachmentIds: attachments.map((file) => file.id),
        inlineImageIds: files.filter((file) => file.kind === 'inline').map((file) => file.id),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (savedId.current) {
        try {
          await dela.mail.deleteDraft(savedId.current);
        } catch {
          onSent('邮件已发送，但本地草稿未能删除，请勿重复发送');
          return;
        }
      }
      onSent(result.warning);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className={cn('flex min-h-0 min-w-0 flex-col bg-muted/30 px-3 pb-3', className)}
      onSubmit={submit}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-4">
        {savedNotice && (
          <span role="status" className="text-xs text-muted-foreground">
            草稿已保存
          </span>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="保存草稿"
          title="保存草稿"
          disabled={sending || saving}
          onClick={() => void saveDraft()}
        >
          <Save />
        </Button>
        <button
          aria-label="关闭写邮件"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <X className="size-4" strokeWidth={1.8} />
        </button>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <strong className="text-sm">新邮件</strong>
          <span className="truncate text-xs text-muted-foreground max-md:hidden">
            从 {accountAddress} 发送
          </span>
        </div>
        <Button className="ml-auto" disabled={sending || saving} size="sm" type="submit">
          {sending ? (
            <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.8} />
          ) : (
            <Send className="size-3.5" strokeWidth={1.8} />
          )}
          {sending ? '正在发送' : '发送邮件'}
        </Button>
      </header>

      <div className="mx-auto mt-3 flex min-h-0 w-full max-w-[760px] flex-1 flex-col rounded-lg border bg-background px-8 pt-5 max-md:px-4 max-md:pt-3">
        <label className="flex min-h-10 items-center border-b border-border/70 transition-colors focus-within:border-foreground/30">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">收件人</span>
          <input
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-muted-foreground"
            onChange={(event) => setTo(event.target.value)}
            placeholder="多个地址用逗号分隔"
            type="text"
            value={to}
          />
        </label>
        <label className="flex min-h-10 items-center border-b border-border/70 transition-colors focus-within:border-foreground/30">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">主题</span>
          <input
            className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-muted-foreground"
            onChange={(event) => setSubject(event.target.value)}
            placeholder="邮件主题"
            type="text"
            value={subject}
          />
        </label>

        {linkDraft === null ? (
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/70">
            <button
              aria-label="加粗"
              aria-pressed={formatState.bold}
              className={toolButtonClass}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format('bold')}
              title="加粗"
              type="button"
            >
              <Bold className="size-4" strokeWidth={1.8} />
            </button>
            <button
              aria-label="斜体"
              aria-pressed={formatState.italic}
              className={toolButtonClass}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format('italic')}
              title="斜体"
              type="button"
            >
              <Italic className="size-4" strokeWidth={1.8} />
            </button>
            <button
              aria-label="添加链接"
              disabled={!hasLinkSelection}
              className={toolButtonClass}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openLinkDraft}
              title={hasLinkSelection ? '添加链接' : '选中文字后添加链接'}
              type="button"
            >
              <Link className="size-4" strokeWidth={1.8} />
            </button>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
            <button
              aria-label="插入图片"
              className={toolButtonClass}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void pickFiles('inline')}
              title="插入图片"
              type="button"
            >
              <ImagePlus className="size-4" strokeWidth={1.8} />
            </button>
            <button
              aria-label="添加附件"
              className={toolButtonClass}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void pickFiles('attachment')}
              title="添加附件"
              type="button"
            >
              <Paperclip className="size-4" strokeWidth={1.8} />
            </button>
          </div>
        ) : (
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70">
            <Link className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
            <input
              autoFocus
              className={cn(
                'min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-muted-foreground',
                linkInvalid && 'text-destructive',
              )}
              onChange={(event) => {
                setLinkDraft(event.target.value);
                setLinkInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelLink();
                }
              }}
              placeholder="https://example.com"
              type="text"
              value={linkDraft}
            />
            {linkInvalid && (
              <span className="min-w-0 shrink truncate text-xs text-destructive">
                请输入有效的链接地址
              </span>
            )}
            <Button onClick={applyLink} size="sm" type="button">
              插入
            </Button>
            <Button onClick={cancelLink} size="sm" type="button" variant="ghost">
              取消
            </Button>
          </div>
        )}

        <div
          aria-label="邮件正文"
          // 矮窗口下正文可收缩（flex-1 正常高度仍撑满），保证附件行与发送错误不被裁掉。
          className="min-h-0 flex-1 overflow-y-auto py-4 text-[13px] leading-relaxed outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-['输入正文'] [&_a]:text-blue-600 [&_a]:underline [&_b]:font-bold [&_strong]:font-bold [&_em]:italic [&_i]:italic [&_img]:my-3 [&_img]:block [&_img]:max-h-[520px] [&_img]:max-w-full [&_img]:rounded-md"
          contentEditable
          onInput={handleEditorInput}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onPaste={pastePlainText}
          onSelect={saveSelection}
          ref={editorRef}
          suppressContentEditableWarning
        />

        {attachments.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-border/70 py-3">
            {attachments.map((file) => (
              <span
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                key={file.id}
              >
                <Paperclip className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.8} />
                <span className="max-w-56 truncate">{file.name}</span>
                <span className="text-muted-foreground">{formatSize(file.size)}</span>
                <button
                  aria-label={`移除 ${file.name}`}
                  className="ml-1 grid size-4 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => removeFile(file.id)}
                  type="button"
                >
                  <X className="size-3" strokeWidth={1.8} />
                </button>
              </span>
            ))}
          </div>
        )}
        {error && (
          <p
            className="shrink-0 border-t border-border/70 py-2 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
