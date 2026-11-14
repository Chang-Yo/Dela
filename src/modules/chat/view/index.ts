// 会话的渲染端出口：聊天界面仍在外壳（renderer/content/chat、renderer/sessions），经这里调用主进程。
import { agentContract } from '../../../core/protocol/agent';
import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { chatContract } from '../contract';

// 会话 store 在模块加载时订阅事件，node 环境的测试也会加载到这里。
const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const agentClient = createClient(agentContract, bridge);
export const chatClient = createClient(chatContract, bridge);

export function onAgentEvent<K extends keyof (typeof agentContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof agentContract, K>) => void,
): () => void {
  return subscribe(agentContract, bridge, name, listener);
}
