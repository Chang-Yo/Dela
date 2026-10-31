import { z } from 'zod';
import type { ChatAskInput } from '../../../../shared/api';
import {
  cancelSessionRun,
  countSessions,
  listSessions,
  newSession,
  readSession,
  row,
  startSessionRun,
  waitSessionRun,
} from '../../session';
import { limit, offset, query, tool, uuid } from '../shared';
import type { AgentTool } from '../shared';

const sessionId = uuid;
const projectId = uuid.nullable().optional();

const listSessionsTool = tool(
  '列出 Dela 会话。默认只列出未归档会话；projectId 省略时列出所有项目，传 null 时只列通用会话。',
  z
    .object({
      projectId,
      query,
      includeArchived: z.boolean().default(false),
      offset,
      limit,
    })
    .strict(),
  ({ projectId, query, includeArchived, offset, limit }) => {
    const items = listSessions(projectId, query, includeArchived, offset, limit);
    const total = countSessions(projectId, query, includeArchived);
    return {
      items,
      total,
      nextOffset: offset + items.length < total ? offset + items.length : null,
    };
  },
);

function messageSize(message: unknown) {
  return JSON.stringify(message).length;
}

const readSessionTool = tool(
  '按会话 ID 分页读取会话投影，保留用户消息、Agent 回复、工具调用和工具结果；不会直接读取 JSONL 或数据库文件。',
  z
    .object({
      sessionId,
      includeArchived: z.boolean().default(false),
      offset,
      limit: z.number().int().min(1).max(100).default(20),
      maxCharacters: z.number().int().min(1).max(200_000).default(60_000),
    })
    .strict(),
  ({ sessionId, includeArchived, offset, limit, maxCharacters }) => {
    const meta = row(sessionId);
    const chat = readSession(sessionId, includeArchived);
    const items: typeof chat.messages = [];
    let characters = 0;
    let nextOffset = offset;
    for (const message of chat.messages.slice(offset)) {
      if (items.length >= limit) break;
      const size = messageSize(message);
      if (items.length > 0 && characters + size > maxCharacters) break;
      items.push(message);
      characters += size;
      nextOffset++;
    }
    return {
      sessionId,
      title: meta.title,
      projectId: meta.project_id,
      offset,
      items,
      total: chat.messages.length,
      characters,
      nextOffset: nextOffset < chat.messages.length ? nextOffset : null,
    };
  },
);

const createSessionTool = tool(
  '强制创建一个新的 Dela 会话，不复用已有的空会话。项目会话传 projectId；通用会话传 null，并选择 chat 或 library 工作目录。',
  z
    .object({
      projectId,
      scope: z.enum(['chat', 'library']).default('chat'),
    })
    .strict(),
  ({ projectId, scope }) => newSession(projectId ?? null, scope, true),
);

const sendSessionMessageTool = tool(
  '向一个未归档会话发送一轮文本消息，立即返回运行 ID；不会把当前会话的历史混入目标会话。',
  z
    .object({
      sessionId,
      text: z.string().max(200_000),
    })
    .strict(),
  async ({ sessionId, text }) => {
    if (row(sessionId).archived) throw new Error('首版不支持向归档会话发送消息');
    const input: ChatAskInput = { text, attachments: [], context: [], comments: [] };
    const runId = await startSessionRun(sessionId, input);
    return { runId, sessionId, status: 'running' as const };
  },
);

const waitSessionRunTool = tool(
  '查询或等待一次会话运行。timeoutMs 为 0 时只查询当前状态；超时只返回当前状态，不会取消运行。',
  z
    .object({
      runId: z.string().trim().min(1).max(100),
      timeoutMs: z.number().int().min(0).max(120_000).default(0),
    })
    .strict(),
  ({ runId, timeoutMs }) => waitSessionRun(runId, timeoutMs),
);

const cancelSessionRunTool = tool(
  '取消指定运行 ID 对应的会话执行；已完成的运行不会被修改。',
  z.object({ runId: z.string().trim().min(1).max(100) }).strict(),
  ({ runId }) => cancelSessionRun(runId),
);

export const sessionTools = {
  list_sessions: listSessionsTool,
  read_session: readSessionTool,
  create_session: createSessionTool,
  send_session_message: sendSessionMessageTool,
  wait_session_run: waitSessionRunTool,
  cancel_session_run: cancelSessionRunTool,
} satisfies Record<string, AgentTool>;
