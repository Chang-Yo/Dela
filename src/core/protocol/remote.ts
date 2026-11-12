// 桌面私有的远端通道视图：不进入 Agent 协议的 JSON Schema，也不带版本。

/** 引导 helper 的步骤：与「引导与恢复」的表格一一对应，也是日志区的行标签。 */
export type RemoteSetupStep =
  'probe' | 'upload' | 'verify' | 'start' | 'tunnel' | 'handshake' | 'ready';

/** 一行引导进度：一步一次，成功与失败各报一次，不做百分比（上传本身也没有细粒度回报）。 */
export interface RemoteSetupProgress {
  step: RemoteSetupStep;
  /** 给人看的一行细节：字节数、端口、失败原因。 */
  detail?: string;
  /** 缺省表示「这一步开始了」；true 成功；false 失败。 */
  ok?: boolean;
  /** 只有上传带：已传与总字节数，界面据此画进度条。 */
  bytes?: { sent: number; total: number };
}

/** helper 通道状态：connecting 首次引导中，ready 可用，reconnecting 隧道断了正在重建（远端任务照跑），
 *  unavailable 起不来或重连超时（这台服务器的项目暂时不能用）。 */
export type RemoteChannelStatus = 'connecting' | 'ready' | 'reconnecting' | 'unavailable';

/** 一条 helper 通道的状态。每个连接各一条通道，送到渲染端的是全部通道的整份快照，
 *  渲染端按目的地对准自己的项目；通道关闭后从快照里消失。 */
export interface RemoteChannelState {
  /** ssh 目的地（host），与连接里的 host 字段一致。 */
  destination: string;
  state: RemoteChannelStatus;
  /** unavailable 时给人看的原因：分类诊断（noexec／只读挂载／SELinux）或原始错误；其余状态为空串。 */
  reason: string;
  /** 进入当前状态的时刻（epoch 毫秒）。 */
  since: number;
}

/** 远端任务（agent 的 bash 调用）的快照：断线期间也在远端继续跑。 */
export interface RemoteTask {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  state: 'running' | 'exited' | 'cancelled' | 'timeout';
  exitCode: number;
  signal?: string;
  /** epoch 毫秒。 */
  startedAt: number;
  durationMs: number;
  /** 已产出的输出字节数。 */
  output: number;
}
