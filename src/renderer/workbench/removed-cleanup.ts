// 项目移除后的工作台清场：资料树移除与删除连接级联两条路径共用。
import type { TabId } from '../../shared/layout';
import { useNavigationStore } from '../navigation/view';
import { useWorkbenchLayout } from './layout-store';
import { walkGroups } from './layout-schema';

/** liveIds 为移除后仍存活的条目 id 全集：关掉指向死条目的标签（chat 与资料预览不指向
 *  条目，照旧放行；草稿随标签卸载自动冲盘释放），退出已死的项目工作台，并清掉
 *  前后退栈里的死项目路由——后退不再跳回已删除的项目。 */
export function purgeRemovedEntries(liveIds: Set<string>): void {
  const layout = useWorkbenchLayout.getState();
  const keep = (tabId: TabId) =>
    tabId.startsWith('chat:') ||
    tabId.startsWith('preview:source:') ||
    liveIds.has(tabId.slice(tabId.indexOf(':') + 1));
  for (const group of walkGroups(layout.root))
    for (const tab of group.tabs) if (!keep(tab)) layout.closeTab(tab, group.id);
  const navigation = useNavigationStore.getState();
  if (navigation.projectId !== null && !liveIds.has(navigation.projectId)) {
    // 不在工作台时不硬切视图，只清指针；返回工作台时自然落回通用池。
    if (navigation.view === 'workbench') navigation.openProject('');
    else useNavigationStore.setState({ projectId: null });
  }
  const deadRoute = (route: { projectId: string | null }) =>
    route.projectId !== null && !liveIds.has(route.projectId);
  useNavigationStore.setState((state) => ({
    backStack: state.backStack.filter((route) => !deadRoute(route)),
    forwardStack: state.forwardStack.filter((route) => !deadRoute(route)),
  }));
}
