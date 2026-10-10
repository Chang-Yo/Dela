import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChatMediaView,
  ChatScope,
  ChatSessionSummary,
  LlmProviderView,
  WorkspaceChat,
} from '../../../shared/api';
import {
  CHAT_ATTACHMENT_MAX,
  hasChatImages,
  stripChatImageTokens,
} from '../../../shared/chat-input';
import { poolKey, useSessions, updateSession } from '../../sessions/store';
import { runBadge, useRuns } from '../../sessions/runs';
import { errorText } from '../../workspace/store';
import { emptyDraft, useChatDrafts, type ChatReference } from './drafts';
import type { ReferenceSource } from './chat-source';

export type { ChatReference };

/** 可发送判定：快捷入口直发（direct）要求文本非空；常规发送允许纯图片（内联图片 token）。 */
export function canSendInput(text: string, direct: boolean): boolean {
  return direct ? text.trim().length > 0 : Boolean(text.trim() || hasChatImages(text));
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

/** 单个会话的对话状态：快照与更新经 sessions 镜像（session:on-update 全局订阅，
 *  同一会话多个入口共享），发送走 session:ask、停止走 session:cancel-run。
 *  输入草稿按 sessionId 持久化（drafts.ts），本 hook 不订阅草稿（订阅在 useChatDraft）；
 *  附件 chip 随视图状态丢失，切换会话时释放暂存文件；内联图片随草稿文本保留
 *  （图片文件由启动 GC 回收）。 */
export function useChat(sessionId: string, referenceSource?: ReferenceSource) {
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

  // 附件暂存：与内联图片共用主进程通道，上限在主进程与这里各校验一次。
  const addAttachmentFile = async (file: File) => {
    if (!window.dela) throw new Error('附件仅在桌面端可用');
    if (attachmentsRef.current.length >= CHAT_ATTACHMENT_MAX)
      throw new Error(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
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
    if (!window.dela || !canSendInput(text, false) || busy) return;
    const requested = sessionId;
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
      setError(errorText(e));
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
          updateDraft(requested, { prompt: text });
          setAttachments(sentAttachments);
        }
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
  // useCallback 保持引用稳定：ChatThread 与消息组件 memo 后，编辑重发入口不带动整树重渲。
  const editLast = useCallback(
    async (text: string) => {
      if (!window.dela || busy) return;
      const requested = sessionId;
      setPending(true);
      setError(null);
      try {
        const result = await window.dela.session.ask(requested, {
          text,
          attachments: [],
          context: [],
          replaceLastUser: true,
        });
        if (result.sessionId) useSessions.getState().putChat(result.sessionId, result);
      } catch (e) {
        if (activeSession.current === requested) setError(errorText(e));
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

  // 两列模型面板的提交：非使用中提供商先 setActive，再设置模型并刷新会话状态。
  const selectModel = (provider: LlmProviderView, model: string) => {
    const dela = window.dela;
    if (!dela) return;
    optimisticChat({ model });
    const switchModel = provider.active
      ? dela.llm.setModel(model)
      : dela.llm.setActive(provider.id).then(() => dela.llm.setModel(model));
    void switchModel.then(() => refresh()).catch((e) => setError(errorText(e)));
  };

  // 思考强度档位切换：乐观更新会话状态，持久化到当前使用中的提供商。
  const selectEffort = (level: string) => {
    const dela = window.dela;
    if (!dela) return;
    optimisticChat({ effort: level });
    void dela.llm
      .setEffort(level)
      .then(() => refresh())
      .catch((e) => setError(errorText(e)));
  };

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
    refresh,
  };
}

/** 当前视图的会话管理：projectId 决定会话池（null = 通用），sessionId 为标签绑定的
 *  会话（workbench 换绑时跟随）；scope 是通用会话的工作目录归属（首页随聊/资料页课程目录），
 *  项目会话忽略它。面板内切换只改本视图的 active，不产生执行。
 *  新建/删除经 session:create/remove；打开视图不启动执行、切换视图不停止执行。 */
export function useChatSession(projectId: string | null, sessionId: string, scope: ChatScope) {
  const [active, setActive] = useState<string | null>(sessionId);
  const [error, setError] = useState<string | null>(null);
  const pool = poolKey(projectId);
  const sessions = useSessions((state) => state.lists[pool] ?? null);

  // workbench 换绑标签会话（props 变化）时跟随；面板内切换不回写 props。
  useEffect(() => {
    setActive(sessionId);
  }, [sessionId]);

  // 镜像列表预热：导航与切换条共用；失败静默（列表按需可再刷）。
  useEffect(() => {
    void useSessions
      .getState()
      .refresh(projectId)
      .catch(() => {});
  }, [projectId]);

  const newSession = useCallback(async () => {
    const dela = window.dela;
    if (!dela) return;
    try {
      // main 复用项目的空会话，重复点击不删除当前输入草稿。
      const chat = await dela.session.create(projectId, scope);
      if (!chat.sessionId) throw new Error('会话创建失败');
      useSessions.getState().putChat(chat.sessionId, chat);
      setActive(chat.sessionId);
      void useSessions
        .getState()
        .refresh(projectId)
        .catch(() => {});
    } catch (e) {
      setError(errorText(e));
    }
  }, [active, projectId, scope]);

  const deleteSession = useCallback(
    async (target: string) => {
      const dela = window.dela;
      if (!dela) return;
      try {
        await updateSession(target, { archived: true });
        void useSessions
          .getState()
          .refresh(projectId)
          .catch(() => {});
        // 删除的是当前会话：进入空态，由用户显式开新对话（新身份模型下发送必须有会话）。
        if (active === target) setActive(null);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [active, projectId],
  );

  // 返回值保持引用稳定（ChatSessionView 整体接收并 memo）：列表刷新、输入等无关
  // 变化不再穿透到会话视图。
  return useMemo(
    () => ({
      /** 会话池的摘要列表镜像（null = 尚未加载）。 */
      sessions: sessions as ChatSessionSummary[] | null,
      /** 当前视图展示的会话；null = 当前会话已被删除。 */
      active,
      /** 切换本视图展示的会话（纯本地状态切换）。 */
      openSession: setActive,
      newSession,
      deleteSession,
      error,
    }),
    [active, deleteSession, error, newSession, sessions],
  );
}
