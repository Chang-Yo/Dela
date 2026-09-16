import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatSessionSummary, LlmProviderView, WorkspaceChat } from '../../../shared/api';
import { errorText, useWorkspace } from '../projects/workspace';
import { emptyDraft, useChatDrafts, type ChatReference } from './drafts';

export type { ChatReference };

/** 首页与项目助手共用的对话状态：会话加载、推送订阅、发送、多会话管理。
 *  输入草稿存于 useChatDrafts（按 scope 持久化），切换页面或重启后不丢失。 */
export function useChat(scope: string, chatRequest?: { sessionId: string }) {
  const [chat, setChat] = useState<WorkspaceChat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const draft = useChatDrafts((state) => state.drafts[scope] ?? emptyDraft);
  const updateDraft = useChatDrafts((state) => state.update);
  const clearDraft = useChatDrafts((state) => state.clear);
  const activeScope = useRef(scope);
  const loadRequest = useRef(0);

  useEffect(() => {
    activeScope.current = scope;
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
    };
  }, [chatRequest, scope]);

  const busy = pending || Boolean(chat?.running);
  const prompt = draft.prompt;
  const references = draft.references;
  const setPrompt = useCallback(
    (text: string) => updateDraft(scope, { prompt: text }),
    [scope, updateDraft],
  );

  // 可选参数供快捷入口直接发送：绕过 prompt state 的异步时序，单击即发。
  const send = async (directText?: string) => {
    const text = (directText ?? prompt).trim();
    if (!window.dela || !text || busy) return;
    const requested = scope;
    const sentReferences = references;
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
    try {
      const result = await window.dela.workspace.ask(
        scope,
        text,
        sentReferences.map((ref) => ref.key),
      );
      if (activeScope.current === requested) setChat(result);
    } catch (e) {
      if (activeScope.current === requested) {
        setError(errorText(e));
        // 消息未上屏（未配置模型、引用读取失败等发生在持久化前）时恢复输入，避免重打。
        const fresh = await window.dela.workspace.getChat(scope).catch(() => null);
        if (
          activeScope.current === requested &&
          !fresh?.messages.some((message) => message.role === 'user' && message.content === text)
        ) {
          updateDraft(requested, { prompt: text, references: sentReferences });
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
