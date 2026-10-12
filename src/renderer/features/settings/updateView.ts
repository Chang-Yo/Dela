// 更新那一条的展示映射，以及标题栏提示的判定。
//
// 渲染层不自行推断状态：文案与可用动作全部由快照的 phase / reason / failedAt 查表得到。
// 后端的更新状态机（src/main/update/state.ts）新增阶段时，这里只有一个地方要跟上，
// 而且漏掉分支会被 updateView.test.ts 的穷举报错。
import type { UpdateReason, UpdateSnapshot, UpdateStep } from '../../../shared/update';

/** 更新那一条上可用的动作；组件负责把它映射到实际的 IPC 调用。 */
export type UpdateAction = UpdateStep | 'open-store';

export interface UpdateView {
  /** 版本号右侧的状态说明；null 表示当前不提。 */
  status: string | null;
  /** 主按钮：null 表示当前阶段没有可做的动作。 */
  action: UpdateAction | null;
  label: string | null;
  /** 0..1，仅下载中给出。 */
  progress: number | null;
}

/** 失败与不可用原因到用户文案。 */
const REASON_STATUS: Record<UpdateReason, string> = {
  'not-packaged': '开发运行不支持应用内更新',
  'not-store': '当前安装方式不支持应用内更新',
  'store-unknown': '商店里没有这个应用的更新信息',
  'store-unavailable': '暂时连不上商店',
  'addon-missing': '更新组件缺失，请重新安装 Dela',
  'window-handle': '没能打开商店的窗口',
  cancelled: '已取消',
  'low-battery': '电量过低，接上电源后再试',
  'wifi-required': '需要在 Wi-Fi 下更新',
  'wifi-recommended': '建议在 Wi-Fi 下更新',
  failed: '更新失败',
};

/**
 * 失败时给什么动作。
 * `not-store` 与 `store-unknown` 是能力问题，重试多少次都一样，只能把用户送去商店；
 * `not-packaged` 与 `addon-missing` 用户在这里做什么都没用，索性不给按钮。
 */
function failureAction(
  reason: UpdateReason,
  failedAt: UpdateStep | null,
): { action: UpdateAction | null; label: string | null } {
  switch (reason) {
    case 'not-store':
    case 'store-unknown':
      return { action: 'open-store', label: '前往商店' };
    case 'not-packaged':
    case 'addon-missing':
      return { action: null, label: null };
    default:
      // 回到失败的那一步，而不是一律从头检查。
      return { action: failedAt ?? 'check', label: '重试' };
  }
}

export function updateView(state: UpdateSnapshot): UpdateView {
  switch (state.phase) {
    case 'idle':
      return { status: null, action: 'check', label: '检查更新', progress: null };
    case 'checking':
      return { status: '正在检查…', action: null, label: null, progress: null };
    case 'up-to-date':
      return { status: '已是最新版本', action: 'check', label: '再检查一次', progress: null };
    case 'available': {
      const found = state.version ? `有新版本 ${state.version}` : '有新版本';
      // 商店不会替应用强制更新，Dela 也没有任何禁用逻辑，所以只说「重要」，
      // 不写成「必须更新」——那样的承诺兑现不了。
      return {
        status: state.mandatory ? `${found}（重要更新）` : found,
        action: 'download',
        label: '下载更新',
        progress: null,
      };
    }
    case 'downloading':
      return {
        status: `正在下载 ${Math.round(state.progress * 100)}%`,
        action: null,
        label: null,
        progress: state.progress,
      };
    case 'ready':
      // 安装期间系统会终止 Dela，且不保证自动重启，先讲清楚再让用户点。
      return {
        status: '更新已下载，安装时 Dela 会关闭',
        action: 'install',
        label: '安装更新',
        progress: null,
      };
    case 'installing':
      return { status: '正在安装，Dela 即将关闭', action: null, label: null, progress: null };
    case 'installed':
      return { status: '更新已安装，请重新打开 Dela', action: null, label: null, progress: null };
    case 'unsupported':
    case 'error': {
      const reason = state.reason ?? 'failed';
      return {
        status: REASON_STATUS[reason],
        ...failureAction(reason, state.failedAt),
        progress: null,
      };
    }
  }
}

/**
 * 标题栏要不要给出更新提示。
 *
 * 只在确实有东西等着用户处理时提示：可下载、下载中、待安装。下载中也算，
 * 因为用户点了下载之后多半就离开设置页去做别的事了。
 * `installing` / `installed` 不提示——更新已经在落地，再亮一个图标只是噪音；
 * 失败也不提示，否则标题栏会为一个用户可能永远修不掉的原因常亮。
 */
export function pendingUpdate(state: UpdateSnapshot): boolean {
  return state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready';
}
