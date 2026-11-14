// 窄屏抽屉由外壳开合，邮箱页要读同一份状态往 #mail-drawer-slot 里渲染文件夹。
import { create } from 'zustand';

/** null 关闭；nav 主导航；mail 邮箱功能层（仅邮箱页可达）。 */
export type MobileDrawer = 'nav' | 'mail';

export const useMobileDrawer = create<{
  drawer: MobileDrawer | null;
  setDrawer: (drawer: MobileDrawer | null) => void;
}>((set) => ({
  drawer: null,
  setDrawer: (drawer) => set({ drawer }),
}));
