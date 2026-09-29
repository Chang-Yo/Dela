import type { WebContents } from 'electron';
import type { RunEvent, RunStatus, WorkspaceChat } from '../../../shared/api';
import { sessionRow, snapshot } from './store';

const chatClients = new Set<WebContents>();

/** 订阅会话事件推送（session:on-update / session:on-run-event 与旧 workspace:chat-update）。 */
export function subscribeChat(client: WebContents) {
  if (chatClients.has(client)) return;
  chatClients.add(client);
  client.once('destroyed', () => chatClients.delete(client));
}

/** 会话快照变化：新通道按 sessionId 广播，同时保留旧 workspace:chat-update（scope, chat）。
 *  旧通道仅剩 TimetableView 一个订阅者（run 结束后刷新课表），scope 由 session.project_id
 *  推导（无项目回退 'home'）。迁移方向：改为订阅 session:on-run-event 的终态事件后删除本推送。
 *  会话已删除时不广播（快照无从生成）。 */
export function publishSession(sessionId: string, partial?: Partial<WorkspaceChat>) {
  const row = sessionRow(sessionId);
  if (!row) return;
  const chat = { ...snapshot(row), ...partial };
  const scope = row.project_id ?? 'home';
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
