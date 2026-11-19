// 项目移除后的工作台清场：资料树移除与删除连接级联两条路径共用。
import type { TabId } from '../../../modules/workspace/contract';
import { useNavigationStore } from '../navigation/view';
import { useWorkbenchLayout } from './layout-store';
import { walkGroups } from './layout-schema';

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
