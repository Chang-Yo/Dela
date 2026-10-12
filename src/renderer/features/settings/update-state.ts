// 更新快照的渲染层镜像。
//
// 主进程是唯一真源（src/main/update/index.ts），这里只存最近一次快照给界面读。
// 标题栏提示与设置页那一条读的是同一个 store，所以订阅整个应用只挂一次：
// 用户从没打开过设置页，标题栏也得能亮。
import { create } from 'zustand';
import type { UpdateSnapshot } from '../../../shared/update';

interface UpdateState {
  snapshot: UpdateSnapshot | null;
  preparingInstall: boolean;
  /** 幂等：首次调用接上主进程广播，之后是空操作。 */
  attach: () => void;
}

let attached = false;

export const useUpdateState = create<UpdateState>((set) => ({
  snapshot: null,
  preparingInstall: false,
  attach: () => {
    if (attached) return;
    const api = window.dela?.update;
    // 浏览器预览没有 preload，保持空快照即可。
    if (!api) return;
    attached = true;
    // 订阅挂在应用上而不是某个组件上：监听者只写 store，不存在写已卸载组件的问题，
    // 因此刻意不保存退订函数——单窗口桌面应用整个生命周期只需要这一份。
    void api.getState().then(
      (snapshot) => set({ snapshot }),
      // 读不到就维持空快照：标题栏安静，设置页按未检查过展示。
      () => {},
    );
    api.onState((snapshot) => set({ snapshot }));
  },
}));
