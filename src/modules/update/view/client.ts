import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { updateContract } from '../contract';

// 更新快照的 store 被外壳与测试在 node 环境加载，取 bridge 前先判断 window。
const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const updateClient = createClient(updateContract, bridge);

export function onUpdateEvent<K extends keyof (typeof updateContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof updateContract, K>) => void,
): () => void {
  return subscribe(updateContract, bridge, name, listener);
}
