// 首页只负责开始聊天；有消息后进入相同会话的标签，历史与运行状态仍由 sessions 管理。
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceChat } from '../../../shared/api';
import { useNavigationStore } from '../../app/navigation';
import { useSessions } from '../../sessions/store';
import { errorText } from '../../workspace/store';
import { ChatTab } from './ChatTab';

export function ChatHome() {
  const request = useNavigationStore((state) => state.generalChat);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ seq: number; promise: Promise<WorkspaceChat> } | null>(null);
  useEffect(() => {
    const api = window.dela?.session;
    if (!api) return;
    let active = true;
    const seq = request?.seq ?? 0;
    if (!pending.current || pending.current.seq !== seq) {
      // 回到首页复用未发送的空会话；“新对话”显式创建，不打开旧的已完成聊天。
      const empty = !request?.create
        ? Object.values(useSessions.getState().chats).find(
            (chat) =>
              chat.sessionId &&
              !chat.running &&
              chat.messages.length === 0 &&
              (useSessions.getState().lists.general ?? []).some((row) => row.id === chat.sessionId),
          )
        : undefined;
      pending.current = { seq, promise: empty ? Promise.resolve(empty) : api.create(null) };
    }
    setError(null);
    void pending.current.promise
      .then((chat) => {
        if (!active) return;
        if (!chat.sessionId) throw new Error('会话创建失败');
        useSessions.getState().putChat(chat.sessionId, chat);
        setSessionId(chat.sessionId);
        void useSessions
          .getState()
          .refresh(null)
          .catch(() => {});
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [request]);
  if (!sessionId)
    return (
      <div
        className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
        role="status"
      >
        {error ?? '正在打开对话…'}
      </div>
    );
  return (
    <ChatTab
      tabId={`chat:${sessionId}`}
      groupId="home"
      onConversation={() => useNavigationStore.getState().openChat(sessionId, null)}
    />
  );
}
