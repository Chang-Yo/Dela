import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { terminalContract } from '../contract';

// 工作台的标签 store 在关闭项目时调用终端，node 环境的测试也会加载到这里。
const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const terminalClient = createClient(terminalContract, bridge);

export function onTerminalEvent<K extends keyof (typeof terminalContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof terminalContract, K>) => void,
): () => void {
  return subscribe(terminalContract, bridge, name, listener);
}
