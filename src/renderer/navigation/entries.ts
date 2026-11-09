// 功能入口的单一真源：侧栏、折叠后标题栏图标与设置 › 通用 的显示开关都读这里。
// 隐藏只影响导航，能力仍在。首页固定显示，不在此列表。
import { CalendarDays, FolderOpen, Mail, MonitorPlay } from 'lucide-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ShuiyuanIcon } from '../components/ui/shuiyuan-icon';

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

export const useNavEntryPrefs = create<{
  hidden: NavEntryId[];
  setVisible: (id: NavEntryId, visible: boolean) => void;
}>()(
  persist(
    (set) => ({
      hidden: [],
      setVisible: (id, visible) =>
        set((state) => ({
          hidden: visible
            ? state.hidden.filter((item) => item !== id)
            : [...new Set([...state.hidden, id])],
        })),
    }),
    { name: 'dela.nav-entries', partialize: (state) => ({ hidden: state.hidden }) },
  ),
);

export function useVisibleNavEntries() {
  const hidden = useNavEntryPrefs((state) => state.hidden);
  return navEntries.filter((entry) => !hidden.includes(entry.id));
}
