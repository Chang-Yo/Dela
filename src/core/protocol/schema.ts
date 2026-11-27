// 协议的 JSON Schema：给移动端生成代码，也是 CI 比对兼容性的依据。
import { z } from 'zod';
import {
  AGENT_PROTOCOL_VERSION,
  agentContract,
  agentEvents,
  agentToolResultSchema,
  chatMediaViewSchema,
  chatMessageSchema,
  chatQueuedDraftSchema,
  chatSessionSummarySchema,
  chatStreamEventSchema,
  contextUsageViewSchema,
  fileChangeSummarySchema,
  sidechatViewSchema,
  turnChangesSchema,
  workspaceChatSchema,
} from './agent';

const named = {
  WorkspaceChat: workspaceChatSchema,
  ChatMessage: chatMessageSchema,
  AgentToolResult: agentToolResultSchema,
  ContextUsage: contextUsageViewSchema,
  ChatSessionSummary: chatSessionSummarySchema,
  ChatMedia: chatMediaViewSchema,
  ChatQueuedDraft: chatQueuedDraftSchema,
  ChatStreamEvent: chatStreamEventSchema,
  SidechatView: sidechatViewSchema,
  TurnChanges: turnChangesSchema,
  FileChangeSummary: fileChangeSummarySchema,
};

export function agentProtocolSchema(): Record<string, unknown> {
  const metadata = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(named)) metadata.add(schema, { id });
  const procedures = z.object(
    Object.fromEntries(
      Object.entries(agentContract.procedures).map(([name, { input, output }]) => [
        name,
        z.object({ input, output }),
      ]),
    ),
  );
  const document = z.object({ procedures, events: z.object(agentEvents) });
  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    ...z.toJSONSchema(document, {
      metadata,
      io: 'input',
      unrepresentable: 'any',
      // 二进制在网关上按 base64 传输。
      override: ({ zodSchema, jsonSchema }) => {
        if (zodSchema._zod.def.type === 'custom')
          Object.assign(jsonSchema, { type: 'string', contentEncoding: 'base64' });
      },
    }),
  };
}
