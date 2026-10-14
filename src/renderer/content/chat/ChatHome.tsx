// 随聊的新建、发送与历史查看留在首页聊天；会话与运行状态由 sessions 管理。
import { useEffect, useRef, useState } from 'react';
import type { DelaApi, WorkspaceChat } from '../../../shared/api';
import type { GeneralChatPulse } from '../../navigation/view';
import { useNavigationStore } from '../../navigation/view';
import { useSessions } from '../../sessions/store';
import { errorText } from '../../workspace/store';
import { ChatTab } from './ChatTab';

/**
 * 首页要打开的会话，优先级：指定历史 > 显式新对话 > 上次停留的会话 > 未发送的空会话 > 新建。
 * 「上次停留」只在本次运行的内存里，所以切到别的页面再回首页能接着上次，重启应用仍是新对话。
 * 上次那个会话已被删除时 open 会失败，落到新对话，不把用户卡在错误提示上。
 */
async function resolveHomeChat(
  api: NonNullable<DelaApi['session']>,
  request: GeneralChatPulse | null,
): Promise<WorkspaceChat> {
  if (request?.sessionId) return api.open(request.sessionId);
  if (request?.create) return api.create(null, 'chat');
  const remembered = useNavigationStore.getState().lastHomeSessionId;
  if (remembered) {
    const reopened = await api.open(remembered).catch(() => null);
    if (reopened) return reopened;
  }
  // 复用未发送的空会话：连续新建不该在历史里留下空壳。
  const empty = Object.values(useSessions.getState().chats).find(
    (chat) =>
      chat.sessionId &&
      !chat.running &&
      chat.messages.length === 0 &&
      (useSessions.getState().lists.general ?? []).some((row) => row.id === chat.sessionId),
  );
  return empty ?? api.create(null, 'chat');
}

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
      pending.current = { seq, promise: resolveHomeChat(api, request) };
    }
    setError(null);
    void pending.current.promise
      .then((chat) => {
        if (!active) return;
        if (!chat.sessionId) throw new Error('会话创建失败');
        useSessions.getState().putChat(chat.sessionId, chat);
        useNavigationStore.getState().rememberHomeSession(chat.sessionId);
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
      <div className="flex flex-1 items-center justify-center p-6 text-13 text-ink-3" role="status">
        {error ?? '正在打开对话…'}
      </div>
    );
  return <ChatTab key={session.id} tabId={`chat:${session.id}`} groupId="home" />;
}
