// 应用内更新契约：主进程持有权威状态机，渲染层只读快照并派发动作。
// 目前唯一可用的校验与安装通道是微软商店（Windows.Services.Store）；
// standalone 表示当前不是商店安装，走「打开商店」兜底。

/** store = 由微软商店安装，可走商店校验与下载；standalone = 其他安装方式。 */
export type UpdateChannel = 'store' | 'standalone';

/** 不可用或失败的原因。取值稳定：渲染层据此选文案，不解析 detail 与原始错误码。 */
export type UpdateReason =
  | 'not-packaged'
  | 'not-store'
  | 'store-unknown'
  | 'store-unavailable'
  | 'addon-missing'
  | 'window-handle'
  | 'cancelled'
  | 'low-battery'
  | 'wifi-required'
  | 'wifi-recommended'
  | 'failed';

/**
 * 更新流程阶段。渲染层只做「阶段 → 文案 + 可用动作」的映射，不自行推断状态。
 * idle → checking → up-to-date | available → downloading → ready → installing → installed
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
  | 'installed'
  | 'unsupported'
  | 'error';

/** 更新的三个可失败步骤，界面据此决定「重试」回到哪一步。 */
export type UpdateStep = 'check' | 'download' | 'install';

export interface UpdateSnapshot {
  phase: UpdatePhase;
  channel: UpdateChannel;
  /** 当前安装版本（package.json 的 version）。 */
  currentVersion: string;
  /** 商店提供的新版本（去掉末尾 .0 段后的显示形式）；无更新时为 null。 */
  version: string | null;
  /** 商店把该更新标记为强制更新；未在 Partner Center 标记时恒为 false。 */
  mandatory: boolean;
  /** 下载进度 0..1；只有 downloading 阶段有意义。 */
  progress: number;
  /** 最近一次检查完成的时刻（ISO）；从未成功检查为 null。 */
  checkedAt: string | null;
  /** 失败或不可用原因；其余阶段为 null。 */
  reason: UpdateReason | null;
  /** 供排查用的原始错误摘要；不直接展示给用户。 */
  detail: string | null;
  /** 上一次失败发生在哪一步；只有 error 与 unsupported 阶段有意义。 */
  failedAt: UpdateStep | null;
}

/** 商店返回的单个待更新包。 */
export interface StorePackageUpdateInfo {
  /** 四段包版本，如 1.0.1.0。 */
  version: string;
  mandatory: boolean;
  familyName: string;
}

export interface UpdateApi {
  getState(): Promise<UpdateSnapshot>;
  /** 向商店校验。已在检查中时返回当前快照，不重复发起。 */
  check(): Promise<UpdateSnapshot>;
  /** 下载已发现的更新；应用保持运行。 */
  download(): Promise<UpdateSnapshot>;
  /** 安装已下载的更新；Windows 可能在此期间关闭本应用。 */
  install(): Promise<UpdateSnapshot>;
  /** 记下「下次启动时提醒」：下次启动准备更新，等待用户确认安装。 */
  deferInstall(): Promise<void>;
  /** 兜底入口：打开商店商品页，由用户在商店里完成更新。 */
  openStorePage(): Promise<void>;
  onState(listener: (state: UpdateSnapshot) => void): () => void;
}
