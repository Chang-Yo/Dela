// 随聊的新建、发送与历史查看留在首页聊天；会话与运行状态由 sessions 管理。
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agentClient } from './client';
import type { WorkspaceChat } from '../../../core/protocol/agent';
import { useSessions } from './sessions';
import { ChatTab } from './ChatTab';
import { errorMessage } from '../../../core/protocol/contract';

/** 首页聊天请求：sessionId 打开指定历史，否则 create 决定新建还是接着上次；seq 区分同内容的再次请求。 */
export interface HomeChatRequest {
  create: boolean;
  sessionId?: string;
  seq: number;
}

/**
 * 首页要打开的会话，优先级：指定历史 > 显式新对话 > 上次停留的会话 > 未发送的空会话 > 新建。
 * 「上次停留」只在本次运行的内存里，所以切到别的页面再回首页能接着上次，重启应用仍是新对话。
 * 上次那个会话已被删除时 open 会失败，落到新对话，不把用户卡在错误提示上。
 */
async function resolveHomeChat(request: HomeChatRequest | null): Promise<WorkspaceChat> {
  if (request?.sessionId) return agentClient['open-session']({ sessionId: request.sessionId });
  if (request?.create) return agentClient['create-session']({ projectId: null, scope: 'chat' });
  const remembered = useSessions.getState().homeSessionId;
  if (remembered) {
    const reopened = await agentClient['open-session']({ sessionId: remembered }).catch(() => null);
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
  return empty ?? agentClient['create-session']({ projectId: null, scope: 'chat' });
}

export function ChatHome({ request }: { request: HomeChatRequest | null }) {
  const queryClient = useQueryClient();
  const queryKey = ['home-chat', request?.seq ?? 0];
  const { data: sessionId, error } = useQuery({
    queryKey,
    enabled: Boolean(window.dela),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () => {
      const chat = await resolveHomeChat(request);
      if (!chat.sessionId) throw new Error('会话创建失败');
      // 已被更新的请求取代（没有视图在看这次结果）时不写镜像，免得旧结果覆盖「上次停留」。
      if (queryClient.getQueryCache().find({ queryKey })?.getObserversCount()) {
        useSessions.getState().putChat(chat.sessionId, chat);
        useSessions.setState({ homeSessionId: chat.sessionId });
        void useSessions
          .getState()
          .refresh(null)
          .catch(() => {});
      }
      return chat.sessionId;
    },
  });
  // 新请求返回前不渲染旧会话，避免沿用旧输入状态或显示已完成的消息。
  if (!sessionId)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-3" role="status">
        {error ? errorMessage(error) : '正在打开对话…'}
      </div>
    );
  return <ChatTab key={sessionId} tabId={`chat:${sessionId}`} groupId="home" />;
}
