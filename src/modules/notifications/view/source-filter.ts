// 通知来源多选筛选：仅保存在内存中，导航切换保留，重启后恢复为全部来源。
import { create } from 'zustand';
import { notificationSources, type NotificationSource } from '../../../shared/api';

interface SourceFilterState {
  sources: readonly NotificationSource[];
  toggleSource: (source: NotificationSource) => void;
}

export const useNotificationSourceFilter = create<SourceFilterState>()((set) => ({
  sources: notificationSources,
  toggleSource: (source) =>
    set(({ sources }) => {
      if (!sources.includes(source))
        return {
          sources: notificationSources.filter(
            (candidate) => candidate === source || sources.includes(candidate),
          ),
        };
      if (sources.length === 1) return {};
      return { sources: sources.filter((candidate) => candidate !== source) };
    }),
}));
