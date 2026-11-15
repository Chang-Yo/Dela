// 功能入口的单一真源：侧栏、折叠后标题栏图标与设置 › 通用 的显示开关都读这里。
// 隐藏只影响导航，能力仍在。首页固定显示，不在此列表。
// 模块页面的入口来自视图清单（docs/adr/0019）。
import type { ComponentType } from 'react';
import { FolderOpen } from 'lucide-react';
import type { NavTargets } from '../../module';
import { navPages } from '../../views';
import { usePreferences } from '../shell/preferences';

export type NavEntryId = 'sources' | keyof NavTargets;

export const navEntries: Array<{
  id: NavEntryId;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [{ id: 'sources', label: '资料', icon: FolderOpen }, ...navPages];

export function useVisibleNavEntries() {
  const hidden = usePreferences((state) => state.hiddenNavEntries);
  return navEntries.filter((entry) => !hidden.includes(entry.id));
}
