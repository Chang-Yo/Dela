import type { WebContents } from 'electron';
import type { RunEvent, RunStatus, WorkspaceChat } from '../../../shared/api';
import { getChat, sessionRow, snapshot } from './store';

const chatClients = new Set<WebContents>();

/** 订阅会话事件推送（session:on-update / session:on-run-event 与旧 workspace:chat-update）。 */
export function subscribeChat(client: WebContents) {
  if (chatClients.has(client)) return;
  chatClients.add(client);
  client.once('destroyed', () => chatClients.delete(client));
}

// 过渡期（阶段三移除）：旧通道的 scope 路由。由旧 scope 入口发起的会话按该入口广播，
// 其余（session:* 新通道）由 session.project_id 推导，无项目回退 'home'。
// TODO(阶段三): renderer 迁移 session:* 通道后移除
const originScopes = new Map<string, string>();

export function setOriginScope(sessionId: string, scope: string) {
  originScopes.set(sessionId, scope);
}

export function clearOriginScope(sessionId: string) {
  originScopes.delete(sessionId);
}

/** 会话快照变化：新通道按 sessionId 广播，同时保留旧 workspace:chat-update（scope, chat）。
 *  会话已删除时不广播（快照无从生成，旧入口的指针态由调用方经 publishChat 发布）。 */
export function publishSession(sessionId: string, partial?: Partial<WorkspaceChat>) {
  const row = sessionRow(sessionId);
  if (!row) return;
  const chat = { ...snapshot(row), ...partial };
  const scope = originScopes.get(sessionId) ?? row.project_id ?? 'home';
  for (const client of chatClients) {
    if (client.isDestroyed()) continue;
    client.send('session:on-update', sessionId, chat);
    client.send('workspace:chat-update', scope, chat);
  }
}

/** Run 状态/活跃工具变化：仅新通道。 */
export function publishRunEvent(
  sessionId: string,
  runId: string,
  status: RunStatus,
  activeTool?: string,
) {
  const event: RunEvent = { sessionId, runId, status, activeTool };
  for (const client of chatClients) {
    if (!client.isDestroyed()) client.send('session:on-run-event', event);
  }
}

/** 旧 scope 语义（过渡兼容）：按该 scope 当前打开的会话（或闲置态）广播旧通道。 */
export function publishChat(scope: string, partial?: Partial<WorkspaceChat>) {
  const chat = { ...getChat(scope), ...partial };
  for (const client of chatClients) {
    if (!client.isDestroyed()) client.send('workspace:chat-update', scope, chat);
  }
}
