// 状态快照的唯一副本在查询缓存（docs/adr/0017）：与过程同名的事件启动时订阅一次，推送直接写入
// [namespace, 过程名] 这一键；先取消同键在途的读取，旧响应就不会覆盖新推送。空推送只让读取过期。
import type { QueryClient } from '@tanstack/react-query';
import type { Bridge } from '../../../core/protocol/contract';

export function connectQueryEvents(
  client: QueryClient,
  channels: readonly string[],
  bridge: Bridge,
): void {
  for (const channel of channels) {
    const queryKey = channel.split(':');
    bridge.subscribe(channel, (payload) => {
      if (payload !== undefined) {
        void client.cancelQueries({ queryKey, exact: true });
        client.setQueryData(queryKey, payload);
      }
      // 带参数的同名读取（如按来源筛选）无法由快照推出，标记过期后重读。
      void client.invalidateQueries({
        queryKey,
        predicate: (query) => query.queryKey.length > 2,
      });
    });
  }
}
