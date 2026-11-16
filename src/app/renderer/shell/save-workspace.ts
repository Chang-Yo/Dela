// 安装更新前的工作区保存：登记给 update 模块的 beforeInstall，任何一步失败都不安装。
import { saveComposers } from '../../../modules/mail/view';
import { useNoteDrafts } from '../../../modules/note/view';
import { saveChatDrafts, runBadge, useRuns } from '../../../modules/chat/view';
import { saveWorkbenchLayout } from '../workbench/layout-store';

export async function saveWorkspace(): Promise<void> {
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
