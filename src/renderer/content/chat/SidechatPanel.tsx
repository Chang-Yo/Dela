// 旁问面板：浮在会话视图右上角的临时对话，虚线边框与标题提示「关闭后不保留」，和主会话的标签、
// 列表都区分开。草稿以 `sidechat:<主会话 id>` 为键（与会话草稿共用存储），附件在面板里各自暂存。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  MessageCircleQuestion,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react';
import type { ChatMediaView, WorkspaceChat } from '../../../shared/api';
import {
  CHAT_ATTACHMENT_MAX,
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_BYTES,
  chatFileKindOfFile,
} from '../../../shared/chat-input';
import { IconButton } from '@/components/ui/beautifului/atoms/IconButton';
import { showToast } from '../../app/toasts';
import { cn } from '../../lib/utils';
import { useNavigationStore } from '../../navigation/view';
import { useSessions } from '../../sessions/store';
import { errorText } from '../../workspace/store';
import { ChatComposer } from './ChatComposer';
import { ChatThread } from './ChatThread';
import type { ReferenceSource } from './chat-source';
import { emptyDraft, useChatDrafts } from './drafts';
import { referenceContext } from './reference-tokens';
import { sidechatDraftKey, useSidechats } from './sidechat-store';
import { canSendInput } from './use-chat';

export function SidechatPanel({
  parentId,
  referenceSource,
  onOpenSource,
}: {
  parentId: string;
  referenceSource?: ReferenceSource;
  onOpenSource?: (key: string) => void;
}) {
  const view = useSidechats((state) => state.views[parentId]);
  const collapsed = useSidechats((state) => state.collapsed[parentId] ?? false);
  const parent = useSessions((state) => state.chats[parentId] ?? null);
  const key = sidechatDraftKey(parentId);
  const draft = useChatDrafts((state) => state.drafts[key] ?? emptyDraft);
  const [attachments, setAttachments] = useState<ChatMediaView[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const options = referenceSource?.useEntries(parent?.projectId ?? null, parent?.cwd ?? null);
  const referenceOptions = useMemo(() => (parent && options ? options : []), [parent, options]);

  useEffect(
    () => () => {
      const ids = attachmentsRef.current.map((item) => item.id);
      if (ids.length) void window.dela?.chat.releaseMedia(ids);
    },
    [],
  );

  // ChatThread 只认会话快照：借主会话的项目与 cwd，sessionId 留空（旁问没有改动记录与分支）。
  const thread = useMemo<WorkspaceChat | null>(
    () =>
      view && parent
        ? {
            ...parent,
            sessionId: null,
            messages: view.messages,
            running: view.running,
            activeTool: view.activeTool,
            compacting: false,
          }
        : null,
    [view, parent],
  );
  if (!view || !parent || !thread) return null;
  const busy = pending || view.running;

  const send = async () => {
    const api = window.dela?.sidechat;
    const { prompt, comments = [] } = useChatDrafts.getState().drafts[key] ?? emptyDraft;
    if (!api || busy || !canSendInput(prompt, false, attachments.length, comments.length)) return;
    const references = referenceContext(prompt, referenceOptions);
    try {
      for (const ref of references)
        if (!ref.key.startsWith('source:')) await referenceSource?.flushReference?.(ref.key);
    } catch (e) {
      setError(errorText(e));
      return;
    }
    const sent = attachments;
    setPending(true);
    setError(null);
    useChatDrafts.getState().clear(key);
    setAttachments([]);
    try {
      useSidechats.getState().put(
        await api.ask(parentId, {
          text: prompt,
          attachments: sent.map((item) => item.id),
          context: references.map((ref) => ref.key),
          comments,
        }),
      );
    } catch (e) {
      setError(errorText(e));
      // 旁问还没上屏就失败（附件读取、模型不可用）：恢复输入，免得重打。
      if (
        !useSidechats
          .getState()
          .views[parentId]?.messages.some((m) => m.role === 'user' && m.content === prompt)
      ) {
        useChatDrafts.getState().update(key, { prompt, comments });
        setAttachments(sent);
      }
    } finally {
      setPending(false);
    }
  };

  const close = () => {
    useChatDrafts.getState().clear(key);
    void window.dela?.sidechat.close(parentId).catch(() => {});
    useSidechats.getState().forget(parentId);
  };

  const keep = () => {
    void window.dela?.sidechat
      .keep(parentId)
      .then((chat) => {
        useChatDrafts.getState().clear(key);
        useSidechats.getState().forget(parentId);
        useSessions.getState().putChat(chat.sessionId!, chat);
        useNavigationStore.getState().openChat(chat.sessionId!, chat.projectId);
      })
      .catch((e) =>
        showToast({ variant: 'error', title: '保留旁问失败', description: errorText(e) }),
      );
  };

  const addAttachmentFile = async (file: File) => {
    if (!window.dela) throw new Error('附件仅在桌面端可用');
    if (attachmentsRef.current.length >= CHAT_ATTACHMENT_MAX)
      throw new Error(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
    const limit =
      (await chatFileKindOfFile(file)) === 'text'
        ? CHAT_TEXT_ATTACHMENT_MAX_BYTES
        : CHAT_DOCUMENT_MAX_BYTES;
    if (file.size > limit) throw new Error(`附件超过 ${limit / 1024 / 1024} MB 上限`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const staged = await window.dela.chat.stageMedia({ name: file.name, bytes });
    setAttachments((current) => [...current, staged]);
  };

  const title = (
    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-2">
      <MessageCircleQuestion className="size-3.5 shrink-0" />
      <span className="truncate">旁问 · 关闭后不保留</span>
      {view.running && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-green" />}
    </span>
  );

  if (collapsed)
    return (
      <button
        aria-label="展开旁问"
        className="absolute right-3 top-12 z-30 flex h-8 items-center gap-1.5 rounded-full border border-dashed border-line-strong bg-surface px-3 shadow-raised transition-colors hover:bg-hover"
        onClick={() => useSidechats.getState().setCollapsed(parentId, false)}
        type="button"
      >
        {title}
        <ChevronDown className="size-3.5 text-ink-3" />
      </button>
    );

  return (
    <section
      aria-label="旁问"
      // 有内容后给定高度：消息区是 flex-1 的滚动容器，只有 max-h 时它撑开而不滚动，长回复被裁掉。
      className={cn(
        'absolute right-3 top-12 z-30 flex max-h-[calc(100%-4rem)] w-[min(26rem,calc(100%-1.5rem))] flex-col rounded-window border border-dashed border-line-strong bg-surface shadow-raised animate-[pop-in_160ms_var(--ease-out-strong)_both]',
        view.messages.length > 0 && 'h-[min(36rem,calc(100%-4rem))]',
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-1 pl-3 pr-1.5">
        {title}
        <div className="flex-1" />
        <IconButton
          aria-label="保留为新会话"
          disabled={busy || view.messages.length === 0}
          onClick={keep}
          title="保留为新会话"
        >
          <SquareArrowOutUpRight />
        </IconButton>
        <IconButton
          aria-label="收起旁问"
          onClick={() => useSidechats.getState().setCollapsed(parentId, true)}
          title="收起"
        >
          <ChevronUp />
        </IconButton>
        <IconButton aria-label="关闭旁问" onClick={close} title="关闭（内容不保留）">
          <X />
        </IconButton>
      </header>
      {view.messages.length === 0 ? (
        <p className="px-3 pb-1 text-xs text-ink-3">
          带着当前对话的上下文顺便问一句，回答不进入主对话。工具与主会话相同，可以读写文件。
        </p>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatThread chat={thread} draftKey={key} onOpenSource={onOpenSource} />
        </div>
      )}
      <div className="shrink-0 p-2">
        <ChatComposer
          attachments={attachments}
          busy={busy}
          comments={draft.comments ?? []}
          configured={parent.configured}
          effort={parent.effort}
          effortLevels={parent.effortLevels}
          model={parent.model}
          modelUnavailable={parent.modelUnavailable}
          notice={error}
          onAddAttachmentFile={addAttachmentFile}
          onAddAttachmentView={(staged) =>
            setAttachments((current) =>
              current.some((item) => item.id === staged.id) ? current : [...current, staged],
            )
          }
          onChange={(prompt) => useChatDrafts.getState().update(key, { prompt })}
          onCommentsChange={(comments) => useChatDrafts.getState().update(key, { comments })}
          onDismissNotice={() => setError(null)}
          onEffortSelect={() => {}}
          onModelSelect={() => {}}
          onRemoveAttachment={(id) => {
            setAttachments((current) => current.filter((item) => item.id !== id));
            void window.dela?.chat.releaseMedia([id]);
          }}
          onSend={() => void send()}
          onStop={() => window.dela?.sidechat.cancel(parentId)}
          providerId={parent.providerId}
          referenceOptions={referenceOptions}
          sidechat
          value={draft.prompt}
        />
      </div>
    </section>
  );
}
