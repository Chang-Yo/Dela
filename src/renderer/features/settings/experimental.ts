// 试验功能开关镜像：总开关 + 子项（当前仅课堂视频）。
// 侧栏入口显隐、设置 › 通用 的管理区与课堂视频页门禁共用此 store，
// 设置里切换即时反映到侧栏，不需要重新挂载。
import { create } from 'zustand';

interface ExperimentalState {
  /** 总开关；null = 尚未读到，开关保持禁用避免闪烁出错误默认值。 */
  master: boolean | null;
  /** 课堂视频子项；主开关关闭时该值不生效。 */
  classroom: boolean;
  load: () => Promise<void>;
  setMaster: (value: boolean) => Promise<void>;
  setClassroom: (value: boolean) => Promise<void>;
}

let loading: Promise<void> | null = null;

export const useExperimental = create<ExperimentalState>((set, get) => ({
  master: null,
  classroom: true,

  load: () => {
    if (get().master !== null) return Promise.resolve();
    if (!loading) {
      loading = (async () => {
        // 浏览器预览没有 preload：视为全关，仅剩设置区的静态说明。
        if (!window.dela) {
          set({ master: false, classroom: false });
          return;
        }
        try {
          const [master, classroom] = await Promise.all([
            window.dela.settings.getExperimentalFeatures(),
            window.dela.settings.getExperimentalClassroom(),
          ]);
          set({ master, classroom });
        } catch {
          set({ master: false, classroom: false });
        }
      })();
    }
    return loading;
  },

  // 乐观更新 + 失败回滚；错误抛给设置区展示。
  setMaster: async (value) => {
    const previous = get().master;
    set({ master: value });
    try {
      const saved = await window.dela!.settings.setExperimentalFeatures(value);
      set({ master: saved });
    } catch {
      set({ master: previous });
      throw new Error('试验功能设置保存失败，请重试。');
    }
  },

  setClassroom: async (value) => {
    const previous = get().classroom;
    set({ classroom: value });
    try {
      const saved = await window.dela!.settings.setExperimentalClassroom(value);
      set({ classroom: saved });
    } catch {
      set({ classroom: previous });
      throw new Error('课堂视频设置保存失败，请重试。');
    }
  },
}));
