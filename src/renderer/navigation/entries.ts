// 功能入口的单一真源：侧栏、折叠后标题栏图标与设置 › 通用 的显示开关都读这里。
// 功能开启 > 入口显示：隐藏只影响导航，能力仍在；功能关闭（目前只有水源）时入口消失。首页固定显示，不在此列表。
import { CalendarDays, FolderOpen, Mail, MonitorPlay } from 'lucide-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ShuiyuanIcon } from '../components/ui/shuiyuan-icon';
import { useExperimentEnabled } from '../features/settings/experimental';

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

/** 功能本身是否开启（关闭时入口不可显示、设置里的显示开关置灰）。 */
export function useNavEntryAvailable(): (id: NavEntryId) => boolean {
  const shuiyuan = useExperimentEnabled('shuiyuan');
  return (id) => id !== 'shuiyuan' || shuiyuan;
}

export function useVisibleNavEntries() {
  const hidden = useNavEntryPrefs((state) => state.hidden);
  const available = useNavEntryAvailable();
  return navEntries.filter((entry) => available(entry.id) && !hidden.includes(entry.id));
}
