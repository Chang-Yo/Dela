// 标签打开规则的唯一出处：所有「打开某样东西」的入口（目录树、资料树、侧栏会话、历史面板、
// 深链、Agent 改动卡片）都只决定「打开什么、是否放到旁边」，落在哪个组、是否预览由这里决定。
//
//   动作                         落点                                  留存
//   单击文件 / 课件               已打开则聚焦；否则当前焦点组           项目工作台：预览（就地替换）
//                                                                       通用（资料）工作台：常驻
//   会话 / 终端 / 审阅            已打开则聚焦；否则当前焦点组           常驻
//   aside（在侧边打开、改动卡片）  焦点组右侧的组；没有就向右分出一个      同上
//                                会话等单例已打开时只聚焦，不开第二份
//
// 资料工作台的课件是并排比对着看的，每个都留标签；项目工作台是干活的地方，只看看的文件不该占栏位。
import type { TabId } from '../../shared/layout';
import { findGroup, walkGroups } from './layout-schema';
import { useWorkbenchLayout } from './layout-store';

/** 文件与资料是「看一眼」的内容，会话、终端、审阅一旦打开就是要留着的工作现场。 */
function previewable(tabId: TabId): boolean {
  return tabId.startsWith('note:') || tabId.startsWith('preview:');
}

/** 焦点组右侧相邻的组；最右时返回 null。 */
function groupRightOfFocus(): string | null {
  const { root, focus } = useWorkbenchLayout.getState();
  const groups = walkGroups(root);
  const index = groups.findIndex((group) => group.id === focus);
  return groups[index + 1]?.id ?? null;
}

/** 按规则打开标签。aside：放到焦点组右侧（必要时分屏），用于「对照着看」。
 *  布局未就绪时只落焦点组（不分屏），由调用方保证就绪后再调用以获得完整语义。 */
export function openTarget(tabId: TabId, options: { aside?: boolean } = {}): void {
  const store = useWorkbenchLayout.getState();
  const preview = previewable(tabId) && store.projectId !== null;
  if (!options.aside) {
    store.openTab(tabId, undefined, { preview });
    return;
  }
  // 会话、终端、审阅是单例的工作现场：已在某组打开就聚焦那里，不在旁边再开一份。
  // 文件允许在旁边开第二份视图（对照同一文件的两处），这是 aside 的本意。
  if (!previewable(tabId) && walkGroups(store.root).some((group) => group.tabs.includes(tabId))) {
    store.openTab(tabId);
    return;
  }
  let target = groupRightOfFocus();
  if (!target && store.ready) {
    const focus = findGroup(store.root, store.focus);
    // 空组不能分屏（splitGroup 要求有活动标签）：直接落进去，它本身就是空出来的位置。
    if (focus?.active) {
      store.splitGroup(focus.id, 'vertical', true);
      target = useWorkbenchLayout.getState().focus;
    }
  }
  useWorkbenchLayout.getState().openTab(tabId, target ?? undefined, { preview });
}
