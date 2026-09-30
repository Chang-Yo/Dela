// agent 域组装入口：应用入口只经此处注册 agent 通道与触及 agent 域的维护/订阅挂钩。
import { registerCapabilitiesIpc } from './capabilities/ipc';
import { registerAgentChannels } from './session/ipc';
import { gcChatMedia } from './session/media';
import { subscribeChat } from './session/subscriptions';
import { interruptStaleRuns } from './session/runs';
import { loadPiRuntime } from './core/pi-load';

// 装配层经此转发（workspace 等业务通道挂会话订阅、启动回收聊天媒体、冒烟验证 Pi 运行时
// 的 ESM 加载），不深进 agent 目录。
export { gcChatMedia, loadPiRuntime, subscribeChat };

export function registerAgentIpc() {
  // 注册时机（迁移完成后、IPC 就绪前）执行一次：上次退出的开放状态 Run 落为
  // interrupted 终态（不自动续跑，「继续」由用户新建 Run）。
  interruptStaleRuns();
  registerAgentChannels();
  registerCapabilitiesIpc();
}
