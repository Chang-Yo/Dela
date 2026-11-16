// 快捷键绑定的 renderer 侧镜像：默认值来自 settings 契约，用户覆盖持久化在 main，
// AppShell、Workbench 与设置 › 快捷键页共用本 store，首帧用默认值，读到覆盖项后就地更新。
import { create } from 'zustand';
import {
  defaultKeybindings,
  mergeKeybindings,
  type KeybindingMap,
  type ShortcutActionId,
} from '../../../modules/settings/contract';
import { settingsClient } from '../../../modules/settings/view';

type Store = {
  bindings: KeybindingMap;
  load: () => Promise<void>;
  setBinding: (id: ShortcutActionId, accelerator: string | null) => Promise<void>;
  resetAll: () => Promise<void>;
};

export const useShortcuts = create<Store>((set) => ({
  bindings: defaultKeybindings(),

  load: async () => {
    if (!window.dela) return;
    try {
      set({ bindings: mergeKeybindings(await settingsClient.keybindings()) });
    } catch {
      /* 读取失败保持默认键位。 */
    }
  },

  setBinding: async (id, accelerator) => {
    if (!window.dela) return;
    set({ bindings: mergeKeybindings(await settingsClient.setKeybindings({ [id]: accelerator })) });
  },

  resetAll: async () => {
    if (!window.dela) return;
    set({ bindings: mergeKeybindings(await settingsClient.resetKeybindings()) });
  },
}));
