// 更新状态机：纯函数，不碰 Electron 与原生模块。主进程是唯一持有者，
// 渲染层只读快照。
//
// 这里唯一需要防守的事情是**迟到与乱序**：商店异步回调、原生模块的进度回调、
// 以及 IPC 层都可能让一个结果事件在状态已经走远之后才到达。规则统一为
// 「结果事件只在它对应的进行中阶段生效，其余一律丢弃并原样返回 state」，
// 于是任何迟到事件都不可能把状态拉回错误阶段。
import type {
  StorePackageUpdateInfo,
  UpdateChannel,
  UpdateReason,
  UpdateSnapshot,
  UpdateStep,
} from '../../shared/update';

export type UpdateEvent =
  | { type: 'check/started' }
  | { type: 'check/available'; updates: StorePackageUpdateInfo[]; checkedAt: string }
  | { type: 'check/up-to-date'; checkedAt: string }
  | { type: 'check/failed'; reason: UpdateReason; detail?: string | null }
  | { type: 'download/started' }
  | { type: 'download/progress'; progress: number }
  | { type: 'download/finished' }
  | { type: 'download/failed'; reason: UpdateReason; detail?: string | null }
  | { type: 'install/started' }
  | { type: 'install/finished' }
  | { type: 'install/failed'; reason: UpdateReason; detail?: string | null };

/** 可以重新发起检查的阶段。下载与安装途中不接受新的检查。 */
const CHECKABLE = new Set<UpdateSnapshot['phase']>([
  'idle',
  'up-to-date',
  'available',
  'unsupported',
  'error',
]);

/**
 * 能力缺失（不再重试也无用）与可重试失败的区分：前者让界面收起重试按钮、
 * 只留「打开商店」兜底，后者允许再点一次。
 */
const MISSING_CAPABILITY: readonly UpdateReason[] = [
  'not-packaged',
  'not-store',
  'store-unknown',
  'addon-missing',
];

export function initialUpdateState(input: {
  channel: UpdateChannel;
  currentVersion: string;
}): UpdateSnapshot {
  return {
    phase: 'idle',
    channel: input.channel,
    currentVersion: input.currentVersion,
    version: null,
    mandatory: false,
    progress: 0,
    checkedAt: null,
    reason: null,
    detail: null,
    failedAt: null,
  };
}

/** 四段包版本去掉末尾的 0 段，与应用内版本号同形。 */
export function formatPackageVersion(raw: string): string {
  const parts = raw.trim().split('.');
  if (parts.length === 4 && parts[3] === '0') parts.pop();
  return parts.join('.');
}

function versionParts(raw: string): number[] {
  return raw
    .trim()
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 多包更新时取最高版本；任意一个包被标记为强制即整体视为强制。 */
export function pickUpdateTarget(
  updates: StorePackageUpdateInfo[],
): { version: string; mandatory: boolean } | null {
  if (updates.length === 0) return null;
  const highest = updates.reduce((best, item) =>
    compareVersions(item.version, best.version) > 0 ? item : best,
  );
  return {
    version: formatPackageVersion(highest.version),
    mandatory: updates.some((item) => item.mandatory),
  };
}

/**
 * 原生模块在真正问商店之前的预检状态：这些不是商店的结论，而是本地前置条件不成立。
 * 后端把它们和商店的失败一起送进这里，保证渲染层只面对一套原因取值。
 */
const PREFLIGHT_REASONS: Record<string, UpdateReason> = {
  NotPackaged: 'not-packaged',
  InvalidWindow: 'window-handle',
  NoUpdates: 'failed',
  Busy: 'failed',
  ChannelFailed: 'failed',
};

/**
 * 失败原因归并。`code` 是 HRESULT，`state` 是商店的 StorePackageUpdateState 名称；
 * 两者都可能缺省，未知一律归为 failed，排查信息交给 detail。
 */
export function reasonFromFailure(failure: {
  code?: number | null;
  state?: string | null;
}): UpdateReason {
  // 原生侧按有符号 int32 传，先转回无符号再比对。
  if (failure.code != null && failure.code >>> 0 === 0x80070578) return 'window-handle';
  const preflight = failure.state ? PREFLIGHT_REASONS[failure.state] : undefined;
  if (preflight) return preflight;
  switch (failure.state) {
    case 'Canceled':
      return 'cancelled';
    case 'ErrorLowBattery':
      return 'low-battery';
    case 'ErrorWiFiRequired':
      return 'wifi-required';
    case 'ErrorWiFiRecommended':
      return 'wifi-recommended';
    default:
      return 'failed';
  }
}

/**
 * 把「哪一步失败了」折成对应的事件。三个步骤的失败事件只有类型名不同，
 * 收敛成一个入口，调用方（包括原生模块意外抛异常时的兜底）就不必按步骤各写一遍。
 */
export function failureEvent(
  step: UpdateStep,
  reason: UpdateReason,
  detail: string | null,
): UpdateEvent {
  if (step === 'check') return { type: 'check/failed', reason, detail };
  if (step === 'download') return { type: 'download/failed', reason, detail };
  return { type: 'install/failed', reason, detail };
}

export function reduceUpdate(state: UpdateSnapshot, event: UpdateEvent): UpdateSnapshot {
  switch (event.type) {
    case 'check/started': {
      if (!CHECKABLE.has(state.phase)) return state;
      return { ...state, phase: 'checking', reason: null, detail: null, failedAt: null };
    }

    case 'check/available': {
      if (state.phase !== 'checking') return state;
      const target = pickUpdateTarget(event.updates);
      if (!target) {
        return {
          ...state,
          phase: 'up-to-date',
          version: null,
          mandatory: false,
          progress: 0,
          checkedAt: event.checkedAt,
          reason: null,
          detail: null,
          failedAt: null,
        };
      }
      return {
        ...state,
        phase: 'available',
        version: target.version,
        mandatory: target.mandatory,
        progress: 0,
        checkedAt: event.checkedAt,
        reason: null,
        detail: null,
      };
    }

    case 'check/up-to-date': {
      if (state.phase !== 'checking') return state;
      return {
        ...state,
        phase: 'up-to-date',
        version: null,
        mandatory: false,
        progress: 0,
        checkedAt: event.checkedAt,
        reason: null,
        detail: null,
      };
    }

    case 'check/failed': {
      if (state.phase !== 'checking') return state;
      return {
        ...state,
        phase: MISSING_CAPABILITY.includes(event.reason) ? 'unsupported' : 'error',
        version: null,
        mandatory: false,
        progress: 0,
        reason: event.reason,
        detail: event.detail ?? null,
        failedAt: 'check',
      };
    }

    case 'download/started': {
      if (
        state.phase !== 'available' &&
        !(state.phase === 'error' && state.failedAt === 'download')
      ) {
        return state;
      }
      return {
        ...state,
        phase: 'downloading',
        progress: 0,
        reason: null,
        detail: null,
        failedAt: null,
      };
    }

    case 'download/progress': {
      if (state.phase !== 'downloading') return state;
      if (!Number.isFinite(event.progress)) return state;
      const progress = Math.min(1, Math.max(0, event.progress));
      // 商店会按包分别上报进度，回退只是噪声。
      if (progress <= state.progress) return state;
      return { ...state, progress };
    }

    case 'download/finished': {
      if (state.phase !== 'downloading') return state;
      return { ...state, phase: 'ready', progress: 1, reason: null, detail: null, failedAt: null };
    }

    case 'download/failed': {
      if (state.phase !== 'downloading') return state;
      return {
        ...state,
        phase: 'error',
        progress: 0,
        reason: event.reason,
        detail: event.detail ?? null,
        failedAt: 'download',
      };
    }

    case 'install/started': {
      if (state.phase !== 'ready' && !(state.phase === 'error' && state.failedAt === 'install')) {
        return state;
      }
      return { ...state, phase: 'installing', reason: null, detail: null, failedAt: null };
    }

    case 'install/finished': {
      if (state.phase !== 'installing') return state;
      return { ...state, phase: 'installed', reason: null, detail: null, failedAt: null };
    }

    case 'install/failed': {
      if (state.phase !== 'installing') return state;
      return {
        ...state,
        phase: 'error',
        progress: 0,
        reason: event.reason,
        detail: event.detail ?? null,
        failedAt: 'install',
      };
    }

    default:
      return state;
  }
}
