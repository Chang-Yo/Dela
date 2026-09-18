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

export type ChatReference = { key: string; title: string };

/** 首页与项目助手共用的对话状态：会话加载、推送订阅、发送、附件暂存与多会话管理。 */
export function useChat(scope: string) {
  const [chat, setChat] = useState<WorkspaceChat | null>(null);
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ChatMediaView[]>([]);
  const [references, setReferences] = useState<ChatReference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const activeScope = useRef(scope);
  // 卸载/切换 scope 清理时读取最新草稿，避免闭包捕获过期状态。
  const draftRef = useRef({ prompt, attachments });
  draftRef.current = { prompt, attachments };

  // 丢弃当前草稿并释放未发送的暂存文件（新对话、切换 scope、卸载）。
  const releaseDraft = useCallback(() => {
    const { prompt: text, attachments: files } = draftRef.current;
    const ids = [...files.map((file) => file.id)];
    for (const token of matchChatImageTokens(text)) if (token[2]) ids.push(token[2]);
    if (ids.length) void window.dela?.chat.releaseMedia(ids);
  }, []);

  useEffect(() => {
    activeScope.current = scope;
    releaseDraft();
    setChat(null);
    setPrompt('');
    setAttachments([]);
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
      releaseDraft();
    };
  }, [scope, releaseDraft]);

  const busy = pending || Boolean(chat?.running);

  // 附件暂存：与内联图片共用主进程通道，上限在主进程与这里各校验一次。
  const addAttachmentFile = async (file: File) => {
    if (!window.dela) throw new Error('附件仅在桌面端可用');
    if (draftRef.current.attachments.length >= CHAT_ATTACHMENT_MAX)
      throw new Error(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = await window.dela.chat.stageMedia({ name: file.name, bytes });
    setAttachments((current) => [...current, view]);
  };

  // 已满时抛错让调用方（选择文件路径）把上限提示显示出来；重复 id 仍静默去重。
  const addAttachmentView = (view: ChatMediaView) => {
    if (draftRef.current.attachments.length >= CHAT_ATTACHMENT_MAX)
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
        const draft = useWorkspace.getState().drafts[ref.key];
        if (draft && draft.text !== draft.saved)
          throw new Error('引用的笔记尚未保存成功，请先保存或移除该引用');
      }
    } catch (e) {
      setError(errorText(e));
      return;
    }
    setPending(true);
    setError(null);
    // 发送即清空输入：用户消息与流式增量经推送回显，不等整轮结束。
    setPrompt('');
    setAttachments([]);
    setReferences([]);
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
          setPrompt(text);
          setReferences(sentReferences);
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

  const newChat = () => {
    if (!window.dela) return;
    releaseDraft();
    void window.dela.workspace
      .newChat(scope)
      .then((value) => {
        setChat(value);
        setPrompt('');
        setAttachments([]);
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
    attachments,
    addAttachmentFile,
    addAttachmentView,
    removeAttachment,
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
    selectModel,
    newChat,
    openSession,
    deleteSession,
    listSessions,
    refresh,
  };
}
