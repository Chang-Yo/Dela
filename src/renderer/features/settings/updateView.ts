// 更新那一条的展示映射，以及标题栏提示的判定。
//
// 渲染层不自行推断状态：文案与可用动作全部由快照的 phase / reason / failedAt 查表得到。
// 后端的更新状态机（src/main/update/state.ts）新增阶段时，这里只有一个地方要跟上，
// 而且漏掉分支会被 updateView.test.ts 的穷举报错。
import type { UpdateReason, UpdateSnapshot, UpdateStep } from '../../../shared/update';

/** 更新那一条上可用的动作；组件负责把它映射到实际的 IPC 调用。 */
export type UpdateAction = UpdateStep | 'open-download';

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
  'feed-unavailable': '暂时无法获取更新信息，请稍后重试',
  'invalid-update': '更新文件校验失败，请重新下载',
  cancelled: '已取消',
  failed: '更新失败',
};

function failureAction(
  reason: UpdateReason,
  failedAt: UpdateStep | null,
): { action: UpdateAction | null; label: string | null } {
  if (reason === 'not-packaged') return { action: null, label: null };
  if (failedAt === 'install') return { action: 'open-download', label: '下载安装包' };
  return { action: failedAt ?? 'check', label: '重试' };
}

export function updateView(state: UpdateSnapshot): UpdateView {
  switch (state.phase) {
    case 'idle':
      return { status: null, action: 'check', label: '检查更新', progress: null };
    case 'checking':
      return { status: '正在检查…', action: null, label: null, progress: null };
    case 'up-to-date':
      return { status: '已是最新版本', action: 'check', label: '再检查一次', progress: null };
    case 'available':
      return {
        status: state.version ? `有新版本 ${state.version}` : '有新版本',
        action: 'download',
        label: '下载更新',
        progress: null,
      };
    case 'downloading':
      return {
        status: '正在下载更新',
        action: null,
        label: null,
        progress: state.progress,
      };
    case 'ready':
      return {
        status: '更新已下载，安装时将退出 Dela 并打开安装向导',
        action: 'install',
        label: '安装更新',
        progress: null,
      };
    case 'installing':
      return {
        status: '正在打开安装向导，Dela 即将退出',
        action: null,
        label: null,
        progress: null,
      };
    case 'unsupported':
    case 'error': {
      const reason = state.reason ?? 'failed';
      return {
        status:
          state.failedAt === 'install'
            ? '无法启动安装向导，请下载安装包后手动安装'
            : REASON_STATUS[reason],
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
 * `installing` 不提示——更新已经在落地，再亮一个图标只是噪音；
 * 失败也不提示，否则标题栏会为一个用户可能永远修不掉的原因常亮。
 */
export function pendingUpdate(state: UpdateSnapshot): boolean {
  return state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready';
}
