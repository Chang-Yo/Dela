import { create } from 'zustand';
import { errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import type { UpdateReason, UpdateSnapshot, UpdateStep } from '../contract';
import { onUpdateEvent, updateClient } from './client';

// 渲染层不自行推断状态：文案与可用动作全部由快照的 phase / reason / failedAt 查表得到。
// 主进程状态机（main/state.ts）新增阶段时只有这里要跟上，漏掉分支会在类型检查时报错。

export type UpdateAction = UpdateStep | 'open-download';

export interface UpdateView {
  status: string | null;
  action: UpdateAction | null;
  label: string | null;
  progress: number | null;
}

const REASON_STATUS: Record<UpdateReason, string> = {
  'not-packaged': '开发运行不支持应用内更新',
  'platform-unsupported': '当前平台暂未提供应用内更新',
  'feed-unavailable': '暂时无法获取更新信息，请稍后重试',
  'invalid-update': '更新文件校验失败，请重新下载',
  cancelled: '已取消',
  failed: '更新失败',
};

function failureAction(
  reason: UpdateReason,
  failedAt: UpdateStep | null,
): { action: UpdateAction | null; label: string | null } {
  if (reason === 'not-packaged' || reason === 'platform-unsupported')
    return { action: null, label: null };
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
        status: state.progress >= 1 ? '下载已传输完成，正在校验并准备安装…' : '正在下载更新',
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

/** 标题栏提示：只在有东西等用户处理时亮（可下载、下载中、待安装）；installing 与失败不提示。 */
export function pendingUpdate(state: UpdateSnapshot): boolean {
  return state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready';
}

// 主进程是唯一真源（main/updater.ts），这里只存最近一次快照给界面读。
// 标题栏提示与设置页那一条读的是同一个 store，订阅由视图定义的 start 挂一次：
// 用户从没打开过设置页，标题栏也得能亮。

interface UpdateState {
  snapshot: UpdateSnapshot | null;
  preparingInstall: boolean;
  dismissedVersion: string | null;
  beforeInstall: (() => Promise<void>) | null;
}

export const useUpdateState = create<UpdateState>(() => ({
  snapshot: null,
  preparingInstall: false,
  dismissedVersion: null,
  beforeInstall: null,
}));

export function startUpdateMirror() {
  if (!window.dela) return;
  if (window.dela.updatedOnLaunch) {
    showToast({ variant: 'success', title: `已更新至 Dela ${window.dela.version}` });
  }
  const receive = (snapshot: UpdateSnapshot) => {
    const previous = useUpdateState.getState().snapshot;
    useUpdateState.setState({ snapshot });
    if (
      snapshot.phase === 'error' &&
      snapshot.failedAt === 'install' &&
      (previous?.phase !== 'error' || previous.failedAt !== 'install')
    ) {
      showToast({
        variant: 'error',
        title: '无法启动安装向导',
        description: updateView(snapshot).status ?? '请下载安装包后手动安装。',
      });
    }
  };
  let receivedPush = false;
  onUpdateEvent('state', (snapshot) => {
    receivedPush = true;
    receive(snapshot);
  });
  void updateClient.state().then(
    (snapshot) => {
      if (!receivedPush) receive(snapshot);
    },
    // 读不到就维持空快照：标题栏安静，设置页按未检查过展示。
    () => {},
  );
}

// 更新动作的派发：设置页那一行与「下载完成」确认弹窗共用同一套。
// 安装前先跑外壳登记的保存，失败就不安装；保存期间由应用级弹窗阻止继续编辑。

export async function runUpdateAction(action: UpdateAction): Promise<boolean> {
  if (!window.dela) return false;
  if (action === 'install') {
    if (useUpdateState.getState().preparingInstall) return false;
    useUpdateState.setState({ preparingInstall: true });
    try {
      await useUpdateState.getState().beforeInstall?.();
    } catch (error) {
      useUpdateState.setState({ preparingInstall: false });
      showToast({
        variant: 'error',
        title: '暂时不能安装',
        description: error instanceof Error ? error.message : '保存工作区失败，请重试。',
      });
      return false;
    }
  }
  try {
    // 打开下载页只借道系统浏览器，没有快照可回填。
    if (action === 'open-download') await updateClient.openDownloadPage();
    // 广播为主；下载完成的 IPC 回执可补回漏掉的 ready，但不能覆盖后续安装状态。
    else {
      const result = await updateClient[action]();
      const current = useUpdateState.getState().snapshot;
      if (
        action === 'download' &&
        result.phase === 'ready' &&
        current?.phase === 'downloading' &&
        current.version === result.version
      ) {
        useUpdateState.setState({ snapshot: result });
      }
      if (result.phase === 'error' || result.phase === 'unsupported') {
        return false;
      }
    }
    return true;
  } catch (error) {
    // 主进程的正常失败都会以快照形式回来，走到这里说明 IPC 本身出了问题，
    // 保持原状态并留下日志，用户可以直接再点一次。
    console.error('Update action failed', error);
    showToast({
      variant: 'error',
      title: '更新操作失败',
      description: errorMessage(error),
    });
    return false;
  } finally {
    if (action === 'install') useUpdateState.setState({ preparingInstall: false });
  }
}

export async function deferInstall(): Promise<boolean> {
  try {
    if (!window.dela) return false;
    await updateClient.deferInstall();
    return true;
  } catch (error) {
    console.error('Defer update install failed', error);
    showToast({
      variant: 'error',
      title: '设置提醒失败',
      description: errorMessage(error),
    });
    return false;
  }
}
