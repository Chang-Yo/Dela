// 远端项目的取数状态：文件树正在连服务器（冷启动要几秒）、已就绪、读失败。
// 目录树是唯一写入方；左侧项目行与资源管理器标题的悬浮提示读同一份状态，
// 这样「正在连接」不会在树里转圈、在提示里却说「已连接」。
import { create } from 'zustand';

export type RemotePhase = 'connecting' | 'ready' | 'failed';

export interface RemoteActivity {
  phase: RemotePhase;
  /** 失败原因（读目录失败时给界面看的那句）。 */
  reason?: string;
}

type Store = {
  byProject: Record<string, RemoteActivity>;
  setPhase: (projectId: string, phase: RemotePhase, reason?: string) => void;
};

export const useRemoteActivity = create<Store>((set) => ({
  byProject: {},
  // 同值不换对象：树与提示都订阅它，重复写同一状态不该带来额外渲染。
  setPhase: (projectId, phase, reason) =>
    set((state) => {
      const prev = state.byProject[projectId];
      if (prev?.phase === phase && prev.reason === reason) return state;
      return { byProject: { ...state.byProject, [projectId]: { phase, reason } } };
    }),
}));
