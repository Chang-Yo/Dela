import type { WebContents } from 'electron';
import type { ChatStreamEvent, RunEvent, RunStatus, WorkspaceChat } from '../../../shared/api';
import { sessionRow, sessionRowWithoutMessages, snapshot } from './store';

const chatClients = new Set<WebContents>();

/** 订阅会话事件推送（session:on-update / session:on-run-event）。 */
export function subscribeChat(client: WebContents) {
  if (chatClients.has(client)) return;
  chatClients.add(client);
  client.once('destroyed', () => chatClients.delete(client));
}

/** 会话快照变化：按 sessionId 广播。
 *  会话已删除时不广播（快照无从生成）。 */
export function publishSession(sessionId: string, partial?: Partial<WorkspaceChat>) {
  // partial 自带内存态消息时跳过 messages 列（该整列 SELECT 与 JSON.parse 的结果会被覆盖丢弃）。
  const row =
    partial?.messages !== undefined ? sessionRowWithoutMessages(sessionId) : sessionRow(sessionId);
  if (!row) return;
  const chat = { ...snapshot(row), ...partial };
  for (const client of chatClients) {
    if (client.isDestroyed()) continue;
    client.send('session:on-update', sessionId, chat);
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

/** 流式增量：只发本轮末条 assistant 消息。渲染端把增量合并进镜像缓存，
 *  会话未打开（无缓存）时丢弃——工具边界与终态仍有全量快照推送兜底。 */
export function publishStreamEvent(
  sessionId: string,
  message: ChatStreamEvent['message'],
  activeTool?: string,
) {
  const event: ChatStreamEvent = { sessionId, message, activeTool };
  for (const client of chatClients) {
    if (!client.isDestroyed()) client.send('session:on-stream', event);
  }
}
