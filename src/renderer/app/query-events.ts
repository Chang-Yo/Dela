// 状态快照的唯一副本在查询缓存（docs/adr/0017）：与过程同名的事件启动时订阅一次，推送直接写入
// [namespace, 过程名] 这一键；先取消同键在途的读取，旧响应就不会覆盖新推送。
import type { QueryClient } from '@tanstack/react-query';
import type { Bridge, Contract } from '../../core/protocol/contract';

export function connectQueryEvents(
  client: QueryClient,
  contracts: Contract[],
  bridge: Bridge | undefined,
): void {
  if (!bridge) return;
  for (const contract of contracts)
    for (const name of Object.keys(contract.events)) {
      if (!(name in contract.procedures)) continue;
      const queryKey = [contract.namespace, name];
      bridge.subscribe(`${contract.namespace}:${name}`, (payload) => {
        void client.cancelQueries({ queryKey, exact: true });
        client.setQueryData(queryKey, payload);
      });
    }
}
