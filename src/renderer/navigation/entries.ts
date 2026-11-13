// 功能入口的单一真源：侧栏、折叠后标题栏图标与设置 › 通用 的显示开关都读这里。
// 隐藏只影响导航，能力仍在。首页固定显示，不在此列表。
import { CalendarDays, FolderOpen, Mail, MonitorPlay } from 'lucide-react';
import { usePreferences } from '../app/preferences';
import { ShuiyuanIcon } from '../features/shuiyuan/shuiyuan-icon';

export type NavEntryId = 'sources' | 'mail' | 'timetable' | 'classroom' | 'shuiyuan';

export const navEntries: Array<{
  id: NavEntryId;
  label: string;
  icon: typeof Mail | typeof ShuiyuanIcon;
}> = [
  { id: 'sources', label: '资料', icon: FolderOpen },
  { id: 'mail', label: '邮箱', icon: Mail },
  { id: 'timetable', label: '课表', icon: CalendarDays },
  { id: 'classroom', label: '课堂视频', icon: MonitorPlay },
  { id: 'shuiyuan', label: '水源(beta)', icon: ShuiyuanIcon },
];

export function useVisibleNavEntries() {
  const hidden = usePreferences((state) => state.hiddenNavEntries);
  return navEntries.filter((entry) => !hidden.includes(entry.id));
}
