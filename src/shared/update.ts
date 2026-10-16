// 应用内更新契约：主进程持有权威状态机，渲染层只读快照并派发动作。

/** 不可用或失败的原因。取值稳定：渲染层据此选文案，不解析 detail 与原始错误码。 */
export type UpdateReason =
  | 'not-packaged'
  | 'platform-unsupported'
  | 'feed-unavailable'
  | 'invalid-update'
  | 'cancelled'
  | 'failed';

/**
 * 更新流程阶段。渲染层只做「阶段 → 文案 + 可用动作」的映射，不自行推断状态。
 * idle → checking → up-to-date | available → downloading → ready → installing
 * 能力缺失进 unsupported，任一环节失败进 error。
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'unsupported'
  | 'error';

/** 更新的三个可失败步骤，界面据此决定「重试」回到哪一步。 */
export type UpdateStep = 'check' | 'download' | 'install';

export interface UpdateSnapshot {
  phase: UpdatePhase;
  /** 当前安装版本（package.json 的 version）。 */
  currentVersion: string;
  /** 更新源提供的新版本；无更新时为 null。 */
  version: string | null;
  /** 下载进度 0..1；只有 downloading 阶段有意义。 */
  progress: number;
  /** 本次传输已下载的字节数；差分下载时是差分传输量。 */
  transferred: number;
  /** 本次传输总字节数；收到进度事件前未知。 */
  total: number | null;
  /** 最近一次检查完成的时刻（ISO）；从未成功检查为 null。 */
  checkedAt: string | null;
  /** 失败或不可用原因；其余阶段为 null。 */
  reason: UpdateReason | null;
  /** 供排查用的原始错误摘要；不直接展示给用户。 */
  detail: string | null;
  /** 上一次失败发生在哪一步；只有 error 与 unsupported 阶段有意义。 */
  failedAt: UpdateStep | null;
}

export interface UpdateApi {
  getState(): Promise<UpdateSnapshot>;
  /** 检查 CDN 的正式版更新。已在检查中时不重复发起。 */
  check(): Promise<UpdateSnapshot>;
  /** 下载已发现的更新；应用保持运行。 */
  download(): Promise<UpdateSnapshot>;
  /** 打开已下载的 NSIS 安装向导并退出；完成后可重新启动。 */
  install(): Promise<UpdateSnapshot>;
  /** 记下「下次启动时提醒」：下次启动准备更新，等待用户确认安装。 */
  deferInstall(): Promise<void>;
  /** 兜底入口：打开安装包下载页。 */
  openDownloadPage(): Promise<void>;
  onState(listener: (state: UpdateSnapshot) => void): () => void;
}
