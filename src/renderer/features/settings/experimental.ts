// 试验功能开关镜像：侧栏入口、设置管理区与课堂视频下载按钮共用，切换即时反映，无需重新挂载。
import { create } from 'zustand';
import type { ExperimentKey, ExperimentState } from '../../../shared/api';

interface ExperimentalStore {
  /** null = 尚未读到，开关保持禁用避免闪烁出错误默认值。 */
  state: ExperimentState | null;
  load: () => Promise<void>;
  set: (key: ExperimentKey, value: boolean) => Promise<void>;
}

const allOff: ExperimentState = { master: false, shuiyuan: false, videoDownload: false };
let loading: Promise<void> | null = null;

export const useExperimental = create<ExperimentalStore>((set, get) => ({
  state: null,

  load: () => {
    if (get().state !== null) return Promise.resolve();
    if (!loading) {
      loading = (async () => {
        // 浏览器预览没有 preload：视为全关，仅剩设置区的静态说明。
        if (!window.dela) {
          set({ state: allOff });
          return;
        }
        try {
          set({ state: await window.dela.settings.getExperiments() });
        } catch {
          set({ state: allOff });
        }
      })();
    }
    return loading;
  },

  // 乐观更新 + 失败回滚；错误抛给设置区展示。
  set: async (key, value) => {
    const previous = get().state;
    if (!previous) return;
    set({ state: { ...previous, [key]: value } });
    try {
      set({ state: await window.dela!.settings.setExperiment(key, value) });
    } catch {
      set({ state: previous });
      throw new Error('试验功能设置保存失败，请重试。');
    }
  },
}));

/** 子项的实际可用性：总开关与子项都开启。未读到时按关闭处理。 */
export function useExperimentEnabled(key: Exclude<ExperimentKey, 'master'>): boolean {
  return useExperimental((store) => Boolean(store.state?.master && store.state[key]));
}
