import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatComment,
  ChatMediaView,
  LlmProviderView,
  SessionCommandName,
  WorkspaceChat,
} from '../../../shared/api';
import { parseSessionCommand } from '../../../shared/api';
import {
  CHAT_ATTACHMENT_MAX,
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_BYTES,
  chatFileKindOfFile,
  hasChatImages,
  stripChatImageTokens,
} from '../../../shared/chat-input';
import { showToast } from '../../app/toasts';
import { useNavigationStore } from '../../navigation/view';
import { useSessions } from '../../sessions/store';
import { runBadge, useRuns } from '../../sessions/runs';
import { errorText } from '../../workspace/store';
import {
  emptyDraft,
  registerChatAttachmentCheck,
  useChatDrafts,
  type ChatReference,
} from './drafts';
import type { ReferenceSource } from './chat-source';
import { openSidechat } from './sidechat-store';

export type { ChatReference };

/** 快捷入口直发要求文本；常规发送也允许只附图片、文件或回复评论。 */
export function canSendInput(
  text: string,
  direct: boolean,
  attachmentCount = 0,
  commentCount = 0,
): boolean {
  return direct
    ? text.trim().length > 0
    : Boolean(text.trim() || hasChatImages(text) || attachmentCount || commentCount);
}

/** 发送失败后是否恢复输入：消息未上屏（快照里没有这条用户消息，或快照读不到）时恢复，
 *  图片 token 留在文本里、附件暂存未被消费，可原样重发；已上屏则只报错不恢复。 */
export function shouldRestoreDraft(fresh: WorkspaceChat | null, sentText: string): boolean {
  if (!fresh) return true;
  const stripped = stripChatImageTokens(sentText);
  return !fresh.messages.some((message) => message.role === 'user' && message.content === stripped);
}

/** 空会话判定：「新对话」切换前移除从未发送过消息的会话，避免空会话进入历史。 */
export function isEmptySession(chat: WorkspaceChat | null): boolean {
  return Boolean(chat && chat.messages.length === 0);
}

/** 输入草稿的响应式订阅：只在 composer 容器层调用——打字每键仅重渲输入区，
 *  不带动消息列表；useChat 内部一律经 useChatDrafts.getState() 命令式读取。 */
export function useChatDraft(sessionId: string) {
  return useChatDrafts((state) => state.drafts[sessionId] ?? emptyDraft);
}

/** 单个会话的对话状态：快照经 sessions 镜像共享（session:on-update 全局订阅，多入口同看一份）。
 *  草稿按 sessionId 持久化（drafts.ts），本 hook 不订阅（订阅在 useChatDraft）；附件 chip
 *  不持久化，切换会话即释放暂存文件；内联图片随草稿文本保留（文件由启动 GC 回收）。
 *  onNewChat 是 /new 命令的落点，与会话视图里的「新对话」按钮同一个动作。 */
export function useChat(
  sessionId: string,
  referenceSource?: ReferenceSource,
  onNewChat?: () => void,
) {
  const chat = useSessions((state) => state.chats[sessionId] ?? null);
  const [attachments, setAttachments] = useState<ChatMediaView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const updateDraft = useChatDrafts((state) => state.update);
  const clearDraft = useChatDrafts((state) => state.clear);
  const activeSession = useRef(sessionId);
  // 卸载/切换会话清理时读取最新附件，避免闭包捕获过期状态。
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => registerChatAttachmentCheck(() => attachmentsRef.current.length > 0), []);
  const flushReference = referenceSource?.flushReference;
  const run = useRuns((state) => state.bySession[sessionId]);

  // 附件 chip 不持久化，离开视图/切换会话即随状态丢弃：释放其暂存文件并清空。
  const releaseAttachments = useCallback(() => {
    const ids = attachmentsRef.current.map((file) => file.id);
    if (ids.length) void window.dela?.chat.releaseMedia(ids);
    setAttachments([]);
  }, []);

  useEffect(() => {
    activeSession.current = sessionId;
    releaseAttachments();
    setError(null);
    setPending(false);
    return () => {
      releaseAttachments();
    };
  }, [sessionId, releaseAttachments]);

  // 快照种子：镜像未缓存（应用启动后首次打开）时经 session:open 读取一次，不产生执行；
  // 缓存被清（会话在别处被删）后再次尝试读取，读到「会话不存在」即就地报错。
  useEffect(() => {
    if (chat) return;
    let active = true;
    void window.dela?.session
      .open(sessionId)
      .then((value) => {
        if (active) useSessions.getState().putChat(sessionId, value);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [chat, sessionId]);

  // 运行结果已被本视图看到（挂载即看、终态到达即看）：清掉导航徽标；
  // 视图关闭期间到达的终态保留，供导航提示「有结果需要处理」。
  useEffect(() => {
    if (!run) return;
    const badge = runBadge(run.status);
    if (badge && badge !== 'running') useRuns.getState().markSeen(sessionId);
  }, [run, sessionId]);

  const busy = pending || Boolean(chat?.running);
  const setPrompt = useCallback(
    (text: string) => updateDraft(sessionId, { prompt: text }),
    [sessionId, updateDraft],
  );
  const setComments = useCallback(
    (comments: ChatComment[]) => updateDraft(sessionId, { comments }),
    [sessionId, updateDraft],
  );

  // 附件暂存：与内联图片共用主进程通道，上限在主进程与这里各校验一次。
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
    const view = await window.dela.chat.stageMedia({ name: file.name, bytes });
    setAttachments((current) => [...current, view]);
  };

  // 已满时抛错让调用方（选择文件路径）把上限提示显示出来；重复 id 仍静默去重。
  const addAttachmentView = (view: ChatMediaView) => {
    if (attachmentsRef.current.length >= CHAT_ATTACHMENT_MAX)
      throw new Error(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
    setAttachments((current) =>
      current.some((item) => item.id === view.id) ? current : [...current, view],
    );
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
    void window.dela?.chat.releaseMedia([id]);
  };

  // 发送前从文本解析好的引用（ChatTab 经 referenceContext 算出）；引用即文本，
  // 删除 = 删掉 @token，无需独立增删入口。
  const send = async (references: ChatReference[]) => {
    // 发送时点读取草稿（不依赖渲染期闭包）：拿到的一定是最后一次按键的值。
    const draft = useChatDrafts.getState().drafts[sessionId] ?? emptyDraft;
    const text = draft.prompt;
    const comments = draft.comments ?? [];
    if (!window.dela || !canSendInput(text, false, attachments.length, comments.length) || busy)
      return;
    const requested = sessionId;
    const command = parseSessionCommand(text);
    if (command) {
      if (comments.length) setError('命令不能附带评论，请先移除评论');
      else await runCommand(command.name, command.args, text);
      return;
    }
    const sentReferences = references;
    const sentAttachments = attachments;
    try {
      if (flushReference) {
        for (const ref of sentReferences) {
          if (ref.key.startsWith('source:')) continue;
          await flushReference(ref.key);
        }
      }
    } catch (e) {
      showToast({ variant: 'error', title: '发送失败', description: errorText(e) });
      return;
    }
    setPending(true);
    setError(null);
    // 发送即清空输入：用户消息与流式增量经推送回显，不等整轮结束。
    clearDraft(requested);
    setAttachments([]);
    try {
      const result = await window.dela.session.ask(requested, {
        text,
        attachments: sentAttachments.map((item) => item.id),
        context: sentReferences.map((ref) => ref.key),
        comments,
      });
      if (result.sessionId) useSessions.getState().putChat(result.sessionId, result);
    } catch (e) {
      // ask 抛错前 run 的终态推送已更新镜像：结果照常写共享缓存，其他入口不受影响。
      if (activeSession.current === requested) {
        setError(errorText(e));
        // 消息未上屏（未配置模型、引用读取失败等发生在持久化前）时恢复输入，避免重打。
        const fresh = await window.dela.session.open(requested).catch(() => null);
        if (fresh) useSessions.getState().putChat(requested, fresh);
        if (activeSession.current === requested && shouldRestoreDraft(fresh, text)) {
          updateDraft(requested, { prompt: text, comments });
          setAttachments(sentAttachments);
        }
      }
    } finally {
      if (activeSession.current === requested) setPending(false);
    }
  };

  /**
   * 会话命令（/compact、/reload、/name、/new、/btw）：不发给模型。失败时恢复输入，方便改了重试；
   * /compact 期间算作忙，停止按钮可以取消压缩。
   */
  const runCommand = async (name: SessionCommandName, args: string, text: string) => {
    const dela = window.dela;
    if (!dela) return;
    const requested = sessionId;
    if (attachments.length) {
      setError('命令不能附带文件，请先移除附件');
      return;
    }
    setError(null);
    clearDraft(requested);
    if (name === 'new') {
      onNewChat?.();
      return;
    }
    if (name === 'btw') {
      void openSidechat(requested, { prompt: args });
      return;
    }
    setPending(true);
    try {
      const result = await dela.session.runCommand(requested, name, args);
      useSessions.getState().putChat(requested, result);
      if (name === 'name') {
        // 标题只在会话列表里，推送不带列表：重读一次，标签与侧栏才会换成新标题。
        void useSessions
          .getState()
          .refresh(result.projectId)
          .catch(() => {});
        showToast({ variant: 'success', title: '已重命名' });
      } else if (name === 'reload') {
        showToast({
          variant: 'success',
          title: '已重新加载',
          description: 'Skills、扩展与 AGENTS.md 已按最新内容加载。',
        });
      }
    } catch (e) {
      if (activeSession.current === requested) {
        setError(errorText(e));
        updateDraft(requested, { prompt: text });
      }
    } finally {
      if (activeSession.current === requested) setPending(false);
    }
  };

  const stop = () => {
    // session:cancel-run 为即发即弃通道（preload 返回 void），失败无从在此提示。
    window.dela?.session.cancelRun(sessionId);
  };

  // 编辑最后一条用户消息并重新生成：主进程截断旧消息后按原 ask 流程重跑。
  // 编辑重发说明原提问不合适，不带回原评论；重试按原消息重发，带上原评论。
  // useCallback 保持引用稳定：ChatThread 与消息组件 memo 后，编辑重发入口不带动整树重渲。
  const editLast = useCallback(
    async (text: string, comments: ChatComment[] = []) => {
      if (!window.dela || busy) return;
      const requested = sessionId;
      setPending(true);
      setError(null);
      try {
        const result = await window.dela.session.ask(requested, {
          text,
          attachments: [],
          context: [],
          comments,
          replaceLastUser: true,
        });
        if (result.sessionId) useSessions.getState().putChat(result.sessionId, result);
      } catch (e) {
        if (activeSession.current === requested)
          showToast({ variant: 'error', title: '重新生成失败', description: errorText(e) });
      } finally {
        if (activeSession.current === requested) setPending(false);
      }
    },
    [busy, sessionId],
  );

  // 模型/思考强度切换的乐观更新直接写镜像缓存，所有入口立即看到新值。
  const optimisticChat = (patch: Partial<WorkspaceChat>) => {
    const current = useSessions.getState().chats[sessionId];
    if (current) useSessions.getState().putChat(sessionId, { ...current, ...patch });
  };

  // 模型选择只属于这个会话，不影响其他会话。
  const selectModel = (provider: LlmProviderView, model: string) => {
    const dela = window.dela;
    if (!dela) return;
    optimisticChat({
      providerId: provider.id,
      providerName: provider.name,
      model,
      modelUnavailable: false,
    });
    void dela.session
      .setModel(sessionId, provider.id, model)
      .then(() => refresh())
      .catch((e) =>
        showToast({ variant: 'error', title: '切换模型失败', description: errorText(e) }),
      );
  };

  const selectEffort = (level: string) => {
    const dela = window.dela;
    if (!dela) return;
    optimisticChat({ effort: level });
    void dela.session
      .setEffort(sessionId, level)
      .then(() => refresh())
      .catch((e) =>
        showToast({ variant: 'error', title: '切换思考强度失败', description: errorText(e) }),
      );
  };

  // 分支是新会话：写进镜像后在当前位置打开，原会话不变。
  const fork = useCallback(
    (entryId: string) => {
      const dela = window.dela;
      if (!dela) return;
      void dela.session
        .fork(sessionId, entryId)
        .then((forked) => {
          useSessions.getState().putChat(forked.sessionId!, forked);
          useNavigationStore.getState().openChat(forked.sessionId!, forked.projectId);
        })
        .catch((e) =>
          showToast({ variant: 'error', title: '分支失败', description: errorText(e) }),
        );
    },
    [sessionId],
  );

  const refresh = () => {
    void window.dela?.session
      .open(sessionId)
      .then((value) => useSessions.getState().putChat(sessionId, value))
      .catch(() => {});
  };

  return {
    chat,
    busy,
    setPrompt,
    setComments,
    attachments,
    addAttachmentFile,
    addAttachmentView,
    removeAttachment,
    error,
    clearError: () => setError(null),
    send,
    stop,
    editLast,
    selectModel,
    selectEffort,
    fork,
    refresh,
  };
}
