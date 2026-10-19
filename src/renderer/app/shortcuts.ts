// 快捷键绑定的 renderer 侧镜像：默认值来自 shared/keybindings，用户覆盖持久化在 main，
// AppShell、Workbench 与设置 › 快捷键页共用本 store，首帧用默认值，读到覆盖项后就地更新。
import { create } from 'zustand';
import {
  defaultKeybindings,
  mergeKeybindings,
  type KeybindingMap,
  type ShortcutActionId,
} from '../../shared/keybindings';

type Store = {
  bindings: KeybindingMap;
  /** 读取覆盖项（失败保持默认值：快捷键属于偏好，不因 IPC 故障整体失效）。 */
  load: () => Promise<void>;
  /** 写入单个动作的键位；null 表示解绑。写入失败向上抛出，由调用方就地提示。 */
  setBinding: (id: ShortcutActionId, accelerator: string | null) => Promise<void>;
  /** 清空全部覆盖，回到默认键位。 */
  resetAll: () => Promise<void>;
};

export const useShortcuts = create<Store>((set) => ({
  bindings: defaultKeybindings(),

  load: async () => {
    const dela = window.dela;
    if (!dela) return;
    try {
      set({ bindings: mergeKeybindings(await dela.settings.getKeybindings()) });
    } catch {
      /* 读取失败保持默认键位。 */
    }
  },

  setBinding: async (id, accelerator) => {
    const dela = window.dela;
    if (!dela) return;
    set({ bindings: mergeKeybindings(await dela.settings.setKeybindings({ [id]: accelerator })) });
  },

  resetAll: async () => {
    const dela = window.dela;
    if (!dela) return;
    set({ bindings: mergeKeybindings(await dela.settings.resetKeybindings()) });
  },
}));
