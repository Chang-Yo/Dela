import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { remotesContract } from '../contract';

// 远程连接客户端被外壳的目录树引用，node 环境的测试也会加载到这里。
const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const remotesClient = createClient(remotesContract, bridge);

export function onRemotesEvent<K extends keyof (typeof remotesContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof remotesContract, K>) => void,
): () => void {
  return subscribe(remotesContract, bridge, name, listener);
}
