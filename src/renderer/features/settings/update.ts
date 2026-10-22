// 更新相关的渲染层逻辑：快照的展示映射、快照镜像 store 与动作派发。
import { create } from 'zustand';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { useNoteDrafts } from '../../content/note/drafts';
import { saveChatDrafts } from '../../content/chat/drafts';
import { saveComposers } from '../mail/compose-close';
import { saveWorkbenchLayout } from '../../workbench/layout-store';
import { useRuns, runBadge } from '../../sessions/runs';
import type { UpdateReason, UpdateSnapshot, UpdateStep } from '../../../shared/update';

// 渲染层不自行推断状态：文案与可用动作全部由快照的 phase / reason / failedAt 查表得到。
// 后端的更新状态机（src/main/update/state.ts）新增阶段时，这里只有一个地方要跟上，
// 而且漏掉分支会被 update-view.test.ts 的穷举报错。

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

// 主进程是唯一真源（src/main/update/index.ts），这里只存最近一次快照给界面读。
// 标题栏提示与设置页那一条读的是同一个 store，所以订阅整个应用只挂一次：
// 用户从没打开过设置页，标题栏也得能亮。

interface UpdateState {
  snapshot: UpdateSnapshot | null;
  preparingInstall: boolean;
  dismissedVersion: string | null;
  /** 幂等：首次调用接上主进程广播，之后是空操作。 */
  attach: () => void;
}

let attached = false;

export const useUpdateState = create<UpdateState>((set, get) => ({
  snapshot: null,
  preparingInstall: false,
  dismissedVersion: null,
  attach: () => {
    if (attached) return;
    const api = window.dela?.update;
    // 浏览器预览没有 preload，保持空快照即可。
    if (!api) return;
    attached = true;
    if (window.dela?.updatedOnLaunch) {
      showToast({ variant: 'success', title: `已更新至 Dela ${window.dela.version}` });
    }
    const receive = (snapshot: UpdateSnapshot) => {
      const previous = get().snapshot;
      set({ snapshot });
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
    // 订阅挂在应用上而不是某个组件上：监听者只写 store，不存在写已卸载组件的问题，
    // 因此刻意不保存退订函数——单窗口桌面应用整个生命周期只需要这一份。
    let receivedPush = false;
    api.onState((snapshot) => {
      receivedPush = true;
      receive(snapshot);
    });
    void api.getState().then(
      (snapshot) => {
        if (!receivedPush) receive(snapshot);
      },
      // 读不到就维持空快照：标题栏安静，设置页按未检查过展示。
      () => {},
    );
  },
}));

// 更新动作的派发：设置页那一行与「下载完成」确认弹窗共用同一套。
// 安装前统一保存工作区；保存期间由应用级弹窗阻止继续编辑。

/**
 * 保存所有已打开文件、聊天文字草稿、邮件草稿和工作台布局；任何一步失败都不安装。
 */
async function saveWorkspace(): Promise<void> {
  if (
    Object.values(useRuns.getState().bySession).some((run) => runBadge(run.status) === 'running')
  ) {
    throw new Error('还有 Agent 任务正在运行，请等待完成或停止任务，再安装更新。');
  }
  saveChatDrafts();
  for (const key of Object.keys(useNoteDrafts.getState().drafts)) {
    if (!(await useNoteDrafts.getState().save(key)))
      throw new Error('有笔记未能保存，请处理后再安装更新。');
  }
  if (!(await saveComposers())) throw new Error('邮件草稿未能保存或正在发送，请处理后再安装更新。');
  if (!(await saveWorkbenchLayout())) throw new Error('工作台布局未能保存，请重试。');
  if (
    Object.values(useNoteDrafts.getState().drafts).some(
      (draft) => draft.saving || draft.text !== draft.saved,
    )
  ) {
    throw new Error('保存期间笔记内容发生变化，请重试。');
  }
  saveChatDrafts();
}

/** 派发更新动作；缺少 API、保存失败或 IPC 失败时返回 false。 */
export async function runUpdateAction(action: UpdateAction): Promise<boolean> {
  const api = window.dela?.update;
  if (!api) return false;
  if (action === 'install') {
    if (useUpdateState.getState().preparingInstall) return false;
    useUpdateState.setState({ preparingInstall: true });
    try {
      await saveWorkspace();
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
    if (action === 'open-download') await api.openDownloadPage();
    // 广播为主；下载完成的 IPC 回执可补回漏掉的 ready，但不能覆盖后续安装状态。
    else {
      const result = await api[action]();
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
      description: errorText(error),
    });
    return false;
  } finally {
    if (action === 'install') useUpdateState.setState({ preparingInstall: false });
  }
}

/** 记下「下次启动时提醒」。 */
export async function deferInstall(): Promise<boolean> {
  try {
    const api = window.dela?.update;
    if (!api) return false;
    await api.deferInstall();
    return true;
  } catch (error) {
    console.error('Defer update install failed', error);
    showToast({
      variant: 'error',
      title: '设置提醒失败',
      description: errorText(error),
    });
    return false;
  }
}
