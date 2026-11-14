import { Bold, ImagePlus, Italic, Link, Paperclip, Send, Save, X } from 'lucide-react';
import { registerComposeClose, registerComposeSave, leaveComposer } from './compose-close';
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mailContract, type MailComposeFile, type PreparedEmail } from '../contract';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/cn';
import { formatSize } from './mail-format';
import { showToast } from '../../../renderer/app/toasts';
import { errorMessage, subscribe } from '../../../core/protocol/contract';
import { draftsKey, mailClient } from './use-mail';
// oxlint-disable-next-line no-restricted-imports -- 过渡：键位解析尚未移入 ui 或 renderer/lib
import { acceleratorFromEvent } from '../../../shared/keybindings';
import { platform } from '../../../renderer/lib/platform';
import { ErrorText } from '../../../ui/alert';
import { Spinner } from '../../../ui/spinner';
import { IconButton } from '../../../ui/icon-button';

/** 邮箱页据此决定再点「写邮件」是否收起撰写面板。 */
export type MailComposerHandle = { dirty: boolean };

type Props = {
  ref?: Ref<MailComposerHandle>;
  draft?: PreparedEmail;
  accountAddress: string;
  onClose: () => void;
  onSent: (warning?: string) => void;
  /** 邮箱 grid 的占位类,由 MailView 按布局档位传入;Dialog 等非网格场景无需传。 */
  className?: string;
  /** 弹窗场景:弹窗自身已是带边框的容器,去掉灰底画布与内卡描边,避免三层框嵌套。 */
  embedded?: boolean;
};

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
  // 离开文档的元素 innerText 会退化为 textContent，丢掉 BR 和块元素的换行。
  let text = '';
  const breakLine = (count: number) => {
    const trailing = text.match(/\n*$/)?.[0].length ?? 0;
    text += '\n'.repeat(Math.max(0, count - trailing));
  };
  const appendText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }
    const breaks = node.tagName === 'P' ? 2 : node.tagName === 'DIV' ? 1 : 0;
    if (breaks && text) breakLine(breaks);
    for (const child of node.childNodes) appendText(child);
    if (breaks) breakLine(breaks);
  };
  for (const child of plainText.childNodes) appendText(child);
  return { html: clone.innerHTML, text: text.replace(/\n+$/, '').replaceAll('\u00a0', ' ') };
}

function draftBody(draft: PreparedEmail): HTMLDivElement {
  const body = document.createElement('div');
  if (!draft.html) {
    for (const [index, line] of draft.text.split(/\r?\n/).entries()) {
      if (index) body.append(document.createElement('br'));
      body.append(document.createTextNode(line));
    }
    return body;
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
  for (const child of parsed.body.childNodes) append(child, body);
  return body;
}

function composeContent(
  account: string,
  recipientText: string,
  subject: string,
  files: readonly MailComposeFile[],
  body: HTMLDivElement | null,
) {
  return {
    account,
    recipientText,
    subject,
    ...(body ? serializeBody(body) : { text: '', html: '' }),
    attachmentIds: files.filter((file) => file.kind === 'attachment').map((file) => file.id),
    inlineImageIds: files.filter((file) => file.kind === 'inline').map((file) => file.id),
  };
}

export function MailComposer({
  ref,
  accountAddress,
  onClose,
  onSent,
  draft,
  className,
  embedded = false,
}: Props) {
  const dela = window.dela!;
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [to, setTo] = useState(draft?.recipientText ?? draft?.to.join(', ') ?? '');
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [bodyHasContent, setBodyHasContent] = useState(Boolean(draft?.text));
  const [files, setFiles] = useState<MailComposeFile[]>(draft?.files ?? []);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  // 发送/保存期间尝试离开被闸门拒绝时给出可见反馈，避免"点了没反应"。
  const [leaveBlocked, setLeaveBlocked] = useState(false);
  const [savedId, setSavedId] = useState(draft?.savedLocally ? draft.id : undefined);
  const [savedContent, setSavedContent] = useState(() =>
    draft?.savedLocally
      ? JSON.stringify(composeContent(accountAddress, to, subject, files, draftBody(draft)))
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [formatState, setFormatState] = useState({ bold: false, italic: false });
  const [hasLinkSelection, setHasLinkSelection] = useState(false);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);

  const dirty = Boolean(to.trim() || subject.trim() || bodyHasContent || files.length || savedId);
  useImperativeHandle(ref, () => ({ dirty }), [dirty]);

  const snapshot = () => composeContent(accountAddress, to, subject, files, editorRef.current);
  useEffect(() => {
    const editor = editorRef.current;
    if (draft && editor) editor.replaceChildren(...draftBody(draft).childNodes);
  }, [draft]);

  const saveDraft = async (): Promise<string | null> => {
    if (sending || saving) return null;
    setSaving(true);
    setError(null);
    try {
      const content = snapshot();
      const result = await mailClient.saveDraft({ ...content, id: savedId });
      const saved = JSON.stringify(content);
      setSavedId(result.id);
      setSavedContent(saved);
      void queryClient.invalidateQueries({ queryKey: draftsKey });
      showToast({ variant: 'success', title: '草稿已保存' });
      return saved;
    } catch (reason) {
      showToast({ variant: 'error', title: '保存草稿失败', description: errorMessage(reason) });
      return null;
    } finally {
      setSaving(false);
      setLeaveBlocked(false);
    }
  };
  const confirmClose = useEffectEvent(async () => {
    if (sending || saving) {
      setLeaveBlocked(true);
      return false;
    }
    if (!dirty || JSON.stringify(snapshot()) === savedContent) return true;
    try {
      const choice = await mailClient.confirmDraftClose();
      if (choice === 'cancel') return false;
      return choice === 'discard' || (await saveDraft()) !== null;
    } catch (reason) {
      showToast({ variant: 'error', title: '保存草稿失败', description: errorMessage(reason) });
      return false;
    }
  });
  const saveBeforeUpdate = useEffectEvent(async () => {
    if (sending || saving) return false;
    if (!dirty || JSON.stringify(snapshot()) === savedContent) return true;
    const saved = await saveDraft();
    return saved !== null && JSON.stringify(snapshot()) === saved;
  });
  useEffect(() => registerComposeClose(() => confirmClose()), []);
  useEffect(() => registerComposeSave(() => saveBeforeUpdate()), []);

  const blocksUnload = useEffectEvent(() => dirty);
  useEffect(() => {
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (!blocksUnload()) return;
      event.preventDefault();
      event.returnValue = false;
    };
    window.addEventListener('beforeunload', preventUnload);
    void mailClient.setComposeActive(true);
    const unsubscribe = subscribe(mailContract, dela.bridge, 'requestClose', (quitting) => {
      const close = () => {
        window.removeEventListener('beforeunload', preventUnload);
        void mailClient.setComposeActive(false).then(() => {
          if (quitting) dela.window.quit();
          else dela.window.close();
        });
      };
      if (!leaveComposer(close)) return;
      close();
    });
    return () => {
      unsubscribe();
      window.removeEventListener('beforeunload', preventUnload);
      void mailClient.setComposeActive(false);
    };
  }, [dela]);

  // 附件暂存仅在发送成功后由主进程释放，其余路径靠卸载释放；StrictMode 假卸载时编辑器仍在文档里，不释放。
  const composeFileIds = useEffectEvent(() => files.map((file) => file.id));
  useEffect(() => {
    const editor = editorRef.current;
    return () => {
      if (editor?.isConnected) return;
      const ids = composeFileIds();
      if (ids.length) void mailClient.releaseComposeFiles(ids);
    };
  }, []);

  const attachments = files.filter((file) => file.kind === 'attachment');

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
    try {
      const inside = editor.contains(range.commonAncestorContainer);
      const bold = inside && document.queryCommandState('bold');
      const italic = inside && document.queryCommandState('italic');
      setFormatState((current) =>
        current.bold === bold && current.italic === italic ? current : { bold, italic },
      );
    } catch {
      /* 环境不支持 queryCommandState 时忽略。 */
    }
  };

  const onSelectionChange = useEffectEvent(saveSelection);
  useEffect(() => {
    const listener = () => onSelectionChange();
    document.addEventListener('selectionchange', listener);
    return () => document.removeEventListener('selectionchange', listener);
  }, []);

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
    let picked: readonly MailComposeFile[];
    try {
      picked = await mailClient.pickComposeFiles(kind);
    } catch (reason) {
      // 用户取消在主进程 resolve 空数组，不会走到这里；reject 均为真实失败。
      showToast({ variant: 'error', title: '选择附件失败', description: errorMessage(reason) });
      return;
    }
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
      void mailClient
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
          showToast({
            variant: 'error',
            title: '插入图片失败',
            description: errorMessage(pasteError),
          });
        });
    });
    reader.readAsDataURL(file);
    return true;
  };

  const removeFile = (id: string) => {
    const editor = editorRef.current;
    editor?.querySelector(`img[data-dela-inline="${CSS.escape(id)}"]`)?.remove();
    setFiles((current) => current.filter((file) => file.id !== id));
    void mailClient.releaseComposeFiles([id]);
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
      if (removed.length) void mailClient.releaseComposeFiles(removed.map((file) => file.id));
      return removed.length
        ? current.filter((file) => file.kind !== 'inline' || activeInlineIds.has(file.id))
        : current;
    });
    setBodyHasContent(
      Boolean(editorRef.current?.innerText.trim()) ||
        Boolean(editorRef.current?.querySelector('img[data-dela-inline]')),
    );
    saveSelection();
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const accelerator = acceleratorFromEvent(event.nativeEvent, platform);
    if (accelerator === 'Mod+B') {
      event.preventDefault();
      format('bold');
      return;
    }
    if (accelerator === 'Mod+I') {
      event.preventDefault();
      format('italic');
      return;
    }
    if (accelerator === 'Mod+K' && editor && hasEditableSelection(editor)) {
      event.preventDefault();
      // 链接键与全局搜索同键：就地消费，避免正文里按 Ctrl/⌘+K 同时弹出搜索框。
      event.stopPropagation();
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
      const result = await mailClient.send({
        to: recipients,
        subject,
        text: body.text,
        html: body.html,
        attachmentIds: attachments.map((file) => file.id),
        inlineImageIds: files.filter((file) => file.kind === 'inline').map((file) => file.id),
      });
      if (!result.ok) {
        showToast({ variant: 'error', title: '发送邮件失败', description: result.error });
        return;
      }
      if (savedId) {
        try {
          await mailClient.deleteDraft(savedId);
        } catch {
          onSent('邮件已发送，但本地草稿未能删除，请勿重复发送');
          return;
        }
        void queryClient.invalidateQueries({ queryKey: draftsKey });
      }
      onSent(result.warning);
    } catch (sendError) {
      showToast({ variant: 'error', title: '发送邮件失败', description: errorMessage(sendError) });
    } finally {
      setSending(false);
      setLeaveBlocked(false);
    }
  };

  return (
    // @container 宿主：撰写卡内边距按面板实宽降档（max-md 看窗口宽度，列表拖宽后失效）。
    <form
      className={cn(
        '@container flex min-h-0 min-w-0 flex-col bg-inset px-3 pb-3',
        embedded && 'bg-transparent p-0',
        className,
      )}
      onSubmit={submit}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        {leaveBlocked && (
          <span role="status" className="text-xs text-ink-3">
            正在发送/保存邮件，完成后即可离开
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
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="关闭写邮件"
          title="关闭"
          onClick={onClose}
        >
          <X />
        </Button>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <strong className="text-sm">新邮件</strong>
          <span className="truncate text-xs text-ink-3 max-md:hidden">
            从 {accountAddress} 发送
          </span>
        </div>
        <Button className="ml-auto" disabled={sending || saving} size="sm" type="submit">
          {sending ? (
            <Spinner size="sm" strokeWidth={1.8} />
          ) : (
            <Send className="size-3.5" strokeWidth={1.8} />
          )}
          {sending ? '正在发送' : '发送邮件'}
        </Button>
      </header>

      <div
        className={cn(
          'mx-auto mt-3 flex min-h-0 w-full max-w-[47.5rem] flex-1 flex-col rounded-card border border-line bg-surface px-4 pt-5 @min-[520px]:px-8 max-md:pt-3',
          embedded && 'mt-0 max-w-none rounded-none border-0',
        )}
      >
        <label className="flex min-h-10 items-center border-b border-line transition-colors focus-within:border-line-strong">
          <span className="w-16 shrink-0 text-xs text-ink-3">收件人</span>
          <input
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-ink-3"
            onChange={(event) => setTo(event.target.value)}
            placeholder="多个地址用逗号分隔"
            type="text"
            value={to}
          />
        </label>
        <label className="flex min-h-10 items-center border-b border-line transition-colors focus-within:border-line-strong">
          <span className="w-16 shrink-0 text-xs text-ink-3">主题</span>
          <input
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-ink-3"
            onChange={(event) => setSubject(event.target.value)}
            placeholder="邮件主题"
            type="text"
            value={subject}
          />
        </label>

        {linkDraft === null ? (
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line">
            <IconButton
              aria-label="加粗"
              aria-pressed={formatState.bold}

              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format('bold')}
              title="加粗"
            >
              <Bold strokeWidth={1.8} />
            </IconButton>
            <IconButton
              aria-label="斜体"
              aria-pressed={formatState.italic}

              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format('italic')}
              title="斜体"
            >
              <Italic strokeWidth={1.8} />
            </IconButton>
            <IconButton
              aria-label="添加链接"
              disabled={!hasLinkSelection}

              onMouseDown={(event) => event.preventDefault()}
              onClick={openLinkDraft}
              title={hasLinkSelection ? '添加链接' : '选中文字后添加链接'}
            >
              <Link strokeWidth={1.8} />
            </IconButton>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
            <IconButton
              aria-label="插入图片"

              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void pickFiles('inline')}
              title="插入图片"
            >
              <ImagePlus strokeWidth={1.8} />
            </IconButton>
            <IconButton
              aria-label="添加附件"

              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void pickFiles('attachment')}
              title="添加附件"
            >
              <Paperclip strokeWidth={1.8} />
            </IconButton>
          </div>
        ) : (
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line">
            <Link className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
            <input
              autoFocus
              className={cn(
                'min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-ink-3',
                linkInvalid && 'text-danger',
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
              <span className="min-w-0 shrink truncate text-xs text-danger">
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
          className="min-h-0 flex-1 overflow-y-auto py-4 text-sm leading-relaxed outline-none empty:before:pointer-events-none empty:before:text-ink-3 empty:before:content-['输入正文'] [&_a]:text-accent-ink [&_a]:underline [&_b]:font-bold [&_strong]:font-bold [&_em]:italic [&_i]:italic [&_img]:my-3 [&_img]:block [&_img]:max-h-[32.5rem] [&_img]:max-w-full [&_img]:rounded-control"
          contentEditable
          style={{ fontSynthesis: 'weight style' }}
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
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-line py-3">
            {attachments.map((file) => (
              <span
                className="inline-flex max-w-full items-center gap-1.5 rounded-control border border-line px-2 py-1 text-xs"
                key={file.id}
              >
                <Paperclip className="size-3 shrink-0 text-ink-3" strokeWidth={1.8} />
                <span className="max-w-56 truncate">{file.name}</span>
                <span className="text-ink-3">{formatSize(file.size)}</span>
                <button
                  aria-label={`移除 ${file.name}`}
                  className="ml-1 grid size-4 place-items-center rounded-chip text-ink-3 hover:bg-hover-strong hover:text-ink"
                  onClick={() => removeFile(file.id)}
                  type="button"
                >
                  <X className="size-3" strokeWidth={1.8} />
                </button>
              </span>
            ))}
          </div>
        )}
        {error && <ErrorText className="shrink-0 border-t border-line py-2">{error}</ErrorText>}
      </div>
    </form>
  );
}
