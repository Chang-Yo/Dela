// 更新动作的派发：设置页那一行与「下载完成」确认弹窗共用同一套。
// 安装前统一保存工作区；保存期间由应用级弹窗阻止继续编辑。
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { useNoteDrafts } from '../../workspace/drafts';
import { saveChatDrafts } from '../../content/chat/drafts';
import { saveComposers } from '../mail/compose-close';
import { saveWorkbenchLayout } from '../../workbench/layout-store';
import { useRuns, runBadge } from '../../sessions/runs';
import { useUpdateState } from './update-state';
import type { UpdateAction } from './updateView';

/**
 * 保存所有已打开笔记、聊天文字草稿、邮件草稿和工作台布局；任何一步失败都不安装。
 * 富文本编辑器先回传正文，避免只保存到 Milkdown 去抖之前的内容。
 */
async function saveWorkspace(): Promise<void> {
  if (
    Object.values(useRuns.getState().bySession).some((run) => runBadge(run.status) === 'running')
  ) {
    throw new Error('还有 Agent 任务正在运行，请等待完成或停止任务，再安装更新。');
  }
  saveChatDrafts();
  const { flushNoteEditors } = await import('../../content/note/NoteEditor');
  flushNoteEditors();
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
    // 其余动作的新状态由主进程广播回来，这里不自己写快照，免得两处状态打架。
    else await api[action]();
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
export async function deferInstall(): Promise<void> {
  try {
    await window.dela?.update.deferInstall();
  } catch (error) {
    console.error('Defer update install failed', error);
    showToast({
      variant: 'error',
      title: '设置提醒失败',
      description: errorText(error),
    });
  }
}
