// 随聊的新建、发送与历史查看留在首页聊天；会话与运行状态由 sessions 管理。
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceChat } from '../../../shared/api';
import { useNavigationStore } from '../../app/navigation';
import { useSessions } from '../../sessions/store';
import { errorText } from '../../workspace/store';
import { ChatTab } from './ChatTab';

export function ChatHome() {
  const request = useNavigationStore((state) => state.generalChat);
  const [session, setSession] = useState<{ id: string; seq: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ seq: number; promise: Promise<WorkspaceChat> } | null>(null);
  useEffect(() => {
    const api = window.dela?.session;
    if (!api) return;
    let active = true;
    const seq = request?.seq ?? 0;
    if (!pending.current || pending.current.seq !== seq) {
      // 未指定历史时复用未发送的空会话；“新对话”显式创建。
      const empty =
        !request?.create && !request?.sessionId
          ? Object.values(useSessions.getState().chats).find(
              (chat) =>
                chat.sessionId &&
                !chat.running &&
                chat.messages.length === 0 &&
                (useSessions.getState().lists.general ?? []).some(
                  (row) => row.id === chat.sessionId,
                ),
            )
          : undefined;
      pending.current = {
        seq,
        promise: request?.sessionId
          ? api.open(request.sessionId)
          : empty
            ? Promise.resolve(empty)
            : api.create(null),
      };
    }
    setError(null);
    void pending.current.promise
      .then((chat) => {
        if (!active) return;
        if (!chat.sessionId) throw new Error('会话创建失败');
        useSessions.getState().putChat(chat.sessionId, chat);
        setSession({ id: chat.sessionId, seq });
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
  // 新请求返回前不渲染旧会话，避免沿用旧输入状态或显示已完成的消息。
  if (!session || session.seq !== (request?.seq ?? 0))
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-3" role="status">
        {error ?? '正在打开对话…'}
      </div>
    );
  return <ChatTab key={session.id} tabId={`chat:${session.id}`} groupId="home" />;
}
