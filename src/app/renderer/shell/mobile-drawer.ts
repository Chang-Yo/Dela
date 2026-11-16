// 窄屏三种抽屉共用一个状态，保证同一时刻只开一个。
import { create } from 'zustand';

export type MobileDrawer = 'nav' | 'page' | 'explorer';

export const useMobileDrawer = create<{
  drawer: MobileDrawer | null;
  setDrawer: (drawer: MobileDrawer | null) => void;
}>((set) => ({
  drawer: null,
  setDrawer: (drawer) => set({ drawer }),
}));
