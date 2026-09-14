import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatSessionSummary, WorkspaceChat } from '../../../shared/api';
import { errorText, useWorkspace } from '../projects/workspace';

export type ChatReference = { key: string; title: string };

/** 首页与项目助手共用的对话状态：会话加载、推送订阅、发送、多会话管理。 */
export function useChat(scope: string) {
  const [chat, setChat] = useState<WorkspaceChat | null>(null);
  const [prompt, setPrompt] = useState('');
  const [references, setReferences] = useState<ChatReference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const activeScope = useRef(scope);

  useEffect(() => {
    activeScope.current = scope;
    setChat(null);
    setPrompt('');
    setReferences([]);
    setError(null);
    setPending(false);
    let active = true;
    void window.dela?.workspace
      .getChat(scope)
      .then((value) => {
        if (active) setChat(value);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    const unsubscribe = window.dela?.workspace.onChatUpdate((updatedScope, value) => {
      if (!active || updatedScope !== scope) return;
      setChat(value);
      if (!value.running) setPending(false);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [scope]);

  const busy = pending || Boolean(chat?.running);

  const send = async () => {
    const text = prompt.trim();
    if (!window.dela || !text || busy) return;
    setPending(true);
    setError(null);
    const requested = scope;
    try {
      for (const ref of references) {
        if (ref.key.startsWith('source:')) continue;
        await useWorkspace.getState().save(ref.key);
        const draft = useWorkspace.getState().drafts[ref.key];
        if (draft && draft.text !== draft.saved)
          throw new Error('引用的笔记尚未保存成功，请先保存或移除该引用');
      }
      const result = await window.dela.workspace.ask(
        scope,
        text,
        references.map((ref) => ref.key),
      );
      if (activeScope.current === requested) {
        setChat(result);
        setPrompt('');
        setReferences([]);
      }
    } catch (e) {
      if (activeScope.current === requested) {
        setError(errorText(e));
        // 用户消息此刻已上屏持久化，失败也要清空输入，避免重发同一段话。
        setPrompt('');
      }
    } finally {
      if (activeScope.current === requested) setPending(false);
    }
  };

  const stop = () => {
    void window.dela?.workspace.cancelAsk(scope).catch((e) => setError(errorText(e)));
  };

  const setModel = (model: string) => {
    if (!window.dela) return;
    void window.dela.llm
      .setModel(model)
      .then(() => setChat((current) => (current ? { ...current, model } : current)))
      .catch((e) => setError(errorText(e)));
  };

  const newChat = () => {
    if (!window.dela) return;
    void window.dela.workspace
      .newChat(scope)
      .then((value) => {
        setChat(value);
        setPrompt('');
        setReferences([]);
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
    addReference: (ref: ChatReference) =>
      setReferences((current) =>
        current.some((item) => item.key === ref.key) ? current : [...current, ref],
      ),
    removeReference: (key: string) =>
      setReferences((current) => current.filter((item) => item.key !== key)),
    error,
    send,
    stop,
    setModel,
    newChat,
    openSession,
    deleteSession,
    listSessions,
    refresh,
  };
}
