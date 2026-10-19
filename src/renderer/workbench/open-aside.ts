// 标签「放到旁边看」的落位规则（唯一出处）：单组向右分出空新组，多组进最右组。
// 落在聚焦组会让新标签挤掉正在看的内容，落最右组才符合「在旁边看」。
// 两个消费方：标题栏「新聊天」/空组空态（navigation/view 的 newChat）准备组后走
// reveal 脉冲开标签；聊天轮次卡片的审阅/打开经 openTabAside 直接开。
import type { TabId } from '../../shared/layout';
import { walkGroups } from './layout-schema';
import { useWorkbenchLayout } from './layout-store';

/** 准备好接收下一个标签的组：单组分出空新组并聚焦，多组聚焦最右组。
 *  只负责落位，不负责开标签——开标签由调用方选自己的机制（直接 openTab / reveal 脉冲）。
 *  布局未就绪时不动作（不对陈旧布局树操作）；空组会拒绝分屏，标签随后落进原焦点组。 */
export function prepareAsideGroup(): void {
  const store = useWorkbenchLayout.getState();
  if (!store.ready) return;
  const groups = walkGroups(store.root);
  const rightmost = groups[groups.length - 1];
  if (!rightmost) return;
  if (groups.length === 1) store.splitGroup(rightmost.id, 'vertical', true);
  else store.focusGroup(rightmost.id);
}

/** prepareAsideGroup + 直接 openTab；布局未就绪时退化为普通打开（落焦点组）。 */
export function openTabAside(tabId: TabId): void {
  prepareAsideGroup();
  useWorkbenchLayout.getState().openTab(tabId);
}
