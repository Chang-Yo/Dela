import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { workspaceContract } from '../contract';

// 工作区客户端被外壳的各个 store 引用，node 环境的测试也会加载到这里。
const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const workspaceClient = createClient(workspaceContract, bridge);

export function onWorkspaceEvent<K extends keyof (typeof workspaceContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof workspaceContract, K>) => void,
): () => void {
  return subscribe(workspaceContract, bridge, name, listener);
}
