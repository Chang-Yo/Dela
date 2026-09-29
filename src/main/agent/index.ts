// agent 域组装入口：应用入口只经此处注册 agent 通道。
import { registerAgentChannels } from './session/ipc';
import { interruptStaleRuns } from './session/runs';

export function registerAgentIpc() {
  // 注册时机（迁移完成后、IPC 就绪前）执行一次：上次退出的开放状态 Run 落为
  // interrupted 终态（不自动续跑，「继续」由用户新建 Run）。
  interruptStaleRuns();
  registerAgentChannels();
}
