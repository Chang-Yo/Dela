/**
 * Pi Agent Core 接入探针的运行时拼装层：自定义 OpenAI 兼容 provider、
 * 事件到 Dela 现有 ask() 回调语义的映射、zod 工具参数桥接。
 * 仅用于验证，不接入应用入口。
 */
import type { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent, StreamFn } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import type {
  Model,
  OpenAICompletionsCompat,
  SimpleStreamOptions,
  TSchema,
} from '@earendil-works/pi-ai';
import { streamSimple as openAiCompletionsStreamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { z } from 'zod';

/** 构造指向任意 OpenAI 兼容服务的 Pi Model；baseUrl 形如 http://127.0.0.1:port/v1。 */
export function buildOpenAiCompatibleModel(options: {
  baseUrl: string;
  modelId: string;
  /** 提供商标识：命中 pi 已知提供商（如 deepseek）会启用对应 compat 自动检测。 */
  provider?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  compat?: OpenAICompletionsCompat;
}): Model<'openai-completions'> {
  return {
    id: options.modelId,
    name: options.modelId,
    api: 'openai-completions',
    provider: options.provider ?? 'dela-openai-compatible',
    baseUrl: options.baseUrl,
    reasoning: options.reasoning ?? false,
    input: options.input ?? ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    ...(options.compat ? { compat: options.compat } : {}),
  };
}

/**
 * 自定义 streamFn：Agent 循环把规范化 transcript 交给该函数，
 * 这里直接复用 pi-ai 的 openai-completions 适配器（内部走 OpenAI SDK fetch）。
 */
export const openAiCompatibleStreamFn: StreamFn = (model, context, options) =>
  openAiCompletionsStreamSimple(
    model as Model<'openai-completions'>,
    context,
    options as SimpleStreamOptions,
  );

/** zod schema → Pi 工具参数：zod 4 原生导出 JSON Schema，Pi 校验对无 TypeBox 标记的参数走 JSON Schema 通道。 */
export function zodParameters(schema: z.ZodType): TSchema {
  return z.toJSONSchema(schema) as TSchema;
}

/** 内建 TypeBox 构造器经由 pi-ai 转出口，避免 Dela 直接依赖 typebox 包。 */
export { Type };

/** Dela 现有 ask() 的回调语义（见 src/main/agent/api.ts）：累计文本、工具开始与结果。 */
export interface DelaStreamCallbacks {
  onText?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolStart?: (call: { id: string; name: string; input: unknown }) => void;
  onToolResult?: (result: { id: string; name: string; input: unknown; output: unknown }) => void;
}

/**
 * Pi Agent 事件 → Dela 回调映射：
 * - message_update 的 text_delta/thinking_delta 携带增量，Dela 需要「本轮累计文本」，这里累计；
 * - tool_execution_end 只带结果，Dela 的 onToolResult 还需要入参，从 start 事件暂存合并。
 */
export function subscribeDelaCallbacks(agent: Agent, callbacks: DelaStreamCallbacks): () => void {
  let text = '';
  let reasoning = '';
  const pendingInputs = new Map<string, unknown>();
  return agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'message_start':
        text = '';
        reasoning = '';
        break;
      case 'message_update':
        if (event.assistantMessageEvent.type === 'text_delta') {
          text += event.assistantMessageEvent.delta;
          callbacks.onText?.(text);
        } else if (event.assistantMessageEvent.type === 'thinking_delta') {
          reasoning += event.assistantMessageEvent.delta;
          callbacks.onReasoning?.(reasoning);
        }
        break;
      case 'tool_execution_start':
        pendingInputs.set(event.toolCallId, event.args);
        callbacks.onToolStart?.({
          id: event.toolCallId,
          name: event.toolName,
          input: event.args,
        });
        break;
      case 'tool_execution_end': {
        const result = event.result as { content?: { type: string; text?: string }[] } | undefined;
        callbacks.onToolResult?.({
          id: event.toolCallId,
          name: event.toolName,
          input: pendingInputs.get(event.toolCallId),
          output: result?.content
            ?.filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n'),
        });
        pendingInputs.delete(event.toolCallId);
        break;
      }
    }
  });
}

/** 探针工具结果的固定形状：content 为文本块，details 存结构化数据。 */
export function textToolResult(text: string): {
  content: { type: 'text'; text: string }[];
  details: Record<string, unknown>;
} {
  return { content: [{ type: 'text', text }], details: {} };
}
