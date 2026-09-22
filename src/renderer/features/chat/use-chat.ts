import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMediaView,
  ChatSessionSummary,
  LlmProviderView,
  WorkspaceChat,
} from '../../../shared/api';
import {
  CHAT_ATTACHMENT_MAX,
  hasChatImages,
  matchChatImageTokens,
  stripChatImageTokens,
} from '../../../shared/chat-input';
import { errorText, useWorkspace } from '../projects/workspace';
import { emptyDraft, useChatDrafts, type ChatReference } from './drafts';

export type { ChatReference };

/** 首页与项目助手共用的对话状态：会话加载、推送订阅、发送、附件暂存与多会话管理。
 *  输入草稿存于 useChatDrafts（按 scope 持久化），切换页面或重启后不丢失；
 *  附件 chip 随组件状态丢失，离开视图时释放暂存文件；内联图片随草稿文本保留
 *  （切走再回来不丢图），文件由启动 GC 回收，重启后残留 token 降级为占位 chip。 */
export function useChat(scope: string, chatRequest?: { sessionId: string }) {
  const [chat, setChat] = useState<WorkspaceChat | null>(null);
  const [attachments, setAttachments] = useState<ChatMediaView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const draft = useChatDrafts((state) => state.drafts[scope] ?? emptyDraft);
  const updateDraft = useChatDrafts((state) => state.update);
  const clearDraft = useChatDrafts((state) => state.clear);
  const activeScope = useRef(scope);
  const loadRequest = useRef(0);
  // 卸载/切换 scope 清理时读取最新附件，避免闭包捕获过期状态。
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // 附件 chip 不持久化，离开视图/切换 scope 即随状态丢弃：释放其暂存文件并清空。
  const releaseAttachments = useCallback(() => {
    const ids = attachmentsRef.current.map((file) => file.id);
    if (ids.length) void window.dela?.chat.releaseMedia(ids);
    setAttachments([]);
  }, []);

  // 新对话时才把内联图片 token 从草稿剥离并释放落盘文件；平时的视图切换不触碰，
  // 否则「切去邮箱查个东西再回来」会把用户贴的截图静默销毁。
  const releaseDraft = useCallback(() => {
    const ids = attachmentsRef.current.map((file) => file.id);
    const stored = useChatDrafts.getState().drafts[scope];
    if (stored) {
      for (const token of matchChatImageTokens(stored.prompt)) if (token[2]) ids.push(token[2]);
      updateDraft(scope, { prompt: stripChatImageTokens(stored.prompt) });
    }
    if (ids.length) void window.dela?.chat.releaseMedia(ids);
    setAttachments([]);
  }, [scope, updateDraft]);

  useEffect(() => {
    activeScope.current = scope;
    releaseAttachments();
    setChat(null);
    setError(null);
    setPending(false);
    let active = true;
    const request = ++loadRequest.current;
    const load = chatRequest
      ? window.dela?.workspace.openChat(scope, chatRequest.sessionId)
      : window.dela?.workspace.getChat(scope);
    if (load) {
      void load
        .then((value) => {
          if (active && request === loadRequest.current) setChat(value);
        })
        .catch((e) => {
          if (active && request === loadRequest.current) setError(errorText(e));
        });
    }
    const unsubscribe = window.dela?.workspace.onChatUpdate((updatedScope, value) => {
      if (!active || updatedScope !== scope) return;
      setChat(value);
      if (!value.running) setPending(false);
    });
    return () => {
      active = false;
      loadRequest.current += 1;
      unsubscribe?.();
      releaseAttachments();
    };
  }, [chatRequest, scope, releaseAttachments]);

  const busy = pending || Boolean(chat?.running);
  const prompt = draft.prompt;
  const references = draft.references;
  const setPrompt = useCallback(
    (text: string) => updateDraft(scope, { prompt: text }),
    [scope, updateDraft],
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

  // 可选参数供快捷入口直接发送：绕过 prompt state 的异步时序，单击即发。
  const send = async (directText?: string) => {
    const text = directText ?? prompt;
    const canSend =
      directText !== undefined
        ? directText.trim().length > 0
        : Boolean(text.trim() || hasChatImages(text));
    if (!window.dela || !canSend || busy) return;
    const requested = scope;
    const sentReferences = references;
    const sentAttachments = attachments;
    try {
      for (const ref of sentReferences) {
        if (ref.key.startsWith('source:')) continue;
        await useWorkspace.getState().save(ref.key);
        const draftNote = useWorkspace.getState().drafts[ref.key];
        if (draftNote && draftNote.text !== draftNote.saved)
          throw new Error('引用的笔记尚未保存成功，请先保存或移除该引用');
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
      const result = await window.dela.workspace.ask(scope, {
        text,
        attachments: sentAttachments.map((item) => item.id),
        context: sentReferences.map((ref) => ref.key),
      });
      if (activeScope.current === requested) setChat(result);
    } catch (e) {
      if (activeScope.current === requested) {
        setError(errorText(e));
        // 消息未上屏（未配置模型、引用读取失败等发生在持久化前）时恢复输入，避免重打；
        // 图片 token 留在文本里，附件暂存未被消费，可原样重发。
        const fresh = await window.dela.workspace.getChat(scope).catch(() => null);
        if (
          activeScope.current === requested &&
          !fresh?.messages.some(
            (message) => message.role === 'user' && message.content === stripChatImageTokens(text),
          )
        ) {
          updateDraft(requested, { prompt: text, references: sentReferences });
          setAttachments(sentAttachments);
        }
      }
    } finally {
      if (activeScope.current === requested) setPending(false);
    }
  };

  const stop = () => {
    void window.dela?.workspace.cancelAsk(scope).catch((e) => setError(errorText(e)));
  };

  // 两列模型面板的提交：非使用中提供商先 setActive，再设置模型并刷新会话状态。
  const selectModel = (provider: LlmProviderView, model: string) => {
    const dela = window.dela;
    if (!dela) return;
    setChat((current) => (current ? { ...current, model } : current));
    const run = provider.active
      ? dela.llm.setModel(model)
      : dela.llm.setActive(provider.id).then(() => dela.llm.setModel(model));
    void run.then(() => refresh()).catch((e) => setError(errorText(e)));
  };

  // 思考强度档位切换：乐观更新会话状态，持久化到当前使用中的提供商。
  const selectEffort = (level: string) => {
    const dela = window.dela;
    if (!dela) return;
    setChat((current) => (current ? { ...current, effort: level } : current));
    void dela.llm
      .setEffort(level)
      .then(() => refresh())
      .catch((e) => setError(errorText(e)));
  };

  const newChat = () => {
    if (!window.dela) return;
    releaseDraft();
    void window.dela.workspace
      .newChat(scope)
      .then((value) => {
        setChat(value);
        clearDraft(scope);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  };

  const openSession = (sessionId: string) => {
    if (!window.dela) return;
    void window.dela.workspace
      .openChat(scope, sessionId)
      .then(setChat)
      .catch((e) => setError(errorText(e)));
  };

  const deleteSession = (sessionId: string) => {
    if (!window.dela) return;
    void window.dela.workspace
      .deleteChat(scope, sessionId)
      .then(() => setChat((current) => (current?.sessionId === sessionId ? null : current)))
      .catch((e) => setError(errorText(e)));
  };

  const refresh = () => {
    void window.dela?.workspace
      .getChat(scope)
      .then(setChat)
      .catch(() => {});
  };

  // 历史弹窗的搜索 effect 以此为依赖，必须保持引用稳定。
  const listSessions = useCallback(
    (query: string): Promise<ChatSessionSummary[]> =>
      window.dela ? window.dela.workspace.listChats(scope, query) : Promise.resolve([]),
    [scope],
  );

  return {
    chat,
    busy,
    prompt,
    setPrompt,
    attachments,
    addAttachmentFile,
    addAttachmentView,
    removeAttachment,
    references,
    addReference: (ref: ChatReference) => {
      const current = useChatDrafts.getState().drafts[scope]?.references ?? [];
      if (current.some((item) => item.key === ref.key)) return;
      updateDraft(scope, { references: [...current, ref] });
    },
    removeReference: (key: string) =>
      updateDraft(scope, {
        references: (useChatDrafts.getState().drafts[scope]?.references ?? []).filter(
          (item) => item.key !== key,
        ),
      }),
    error,
    send,
    stop,
    selectModel,
    selectEffort,
    newChat,
    openSession,
    deleteSession,
    listSessions,
    refresh,
  };
}
