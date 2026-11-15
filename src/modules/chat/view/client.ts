// 会话、模型服务与能力配置的契约客户端（后两者的主进程实现由 app/main/agent-ipc 注册）。
import { agentContract } from '../../../core/protocol/agent';
import { capabilitiesContract } from '../../../core/protocol/capabilities';
import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { llmContract } from '../../../core/protocol/llm';
import { chatContract } from '../contract';

// 会话 store 在模块加载时订阅事件，node 环境的测试也会加载到这里。
const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const agentClient = createClient(agentContract, bridge);
export const chatClient = createClient(chatContract, bridge);
export const llmClient = createClient(llmContract, bridge);
export const capabilitiesClient = createClient(capabilitiesContract, bridge);

export function onAgentEvent<K extends keyof (typeof agentContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof agentContract, K>) => void,
): () => void {
  return subscribe(agentContract, bridge, name, listener);
}

export function onWebSearchChanged(listener: () => void): () => void {
  return subscribe(capabilitiesContract, bridge, 'webSearchChanged', listener);
}
