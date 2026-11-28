// 桌面私有的远端通道视图：不进入 Agent 协议的 JSON Schema，也不带版本。

export type RemoteSetupStep =
  | 'probe'
  | 'upload'
  | 'verify'
  | 'start'
  | 'tunnel'
  | 'handshake'
  | 'ready';

export interface RemoteSetupProgress {
  step: RemoteSetupStep;
  detail?: string;
  ok?: boolean;
  bytes?: { sent: number; total: number };
}

/** helper 通道状态：connecting 首次引导中，ready 可用，reconnecting 隧道断了正在重建（远端任务照跑），
 *  unavailable 起不来或重连超时（这台服务器的项目暂时不能用）。 */
export type RemoteChannelStatus = 'connecting' | 'ready' | 'reconnecting' | 'unavailable';

/** 一条 helper 通道的状态：送到渲染端的是全部通道的整份快照，通道关闭后从快照里消失。 */
export interface RemoteChannelState {
  destination: string;
  state: RemoteChannelStatus;
  /** unavailable 时给人看的原因：分类诊断（noexec／只读挂载／SELinux）或原始错误；其余状态为空串。 */
  reason: string;
  since: number;
}

export interface RemoteTask {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  state: 'running' | 'exited' | 'cancelled' | 'timeout';
  exitCode: number;
  signal?: string;
  startedAt: number;
  durationMs: number;
  output: number;
}
