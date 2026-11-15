// 远端项目的取数状态（连接中/就绪/读失败），由目录树独占写入；左侧项目行与资源管理器
// 标题的悬浮提示读同一份状态，避免树里在转圈、提示里却说「已连接」。
import { create } from 'zustand';

export type RemotePhase = 'connecting' | 'ready' | 'failed';

export interface RemoteActivity {
  phase: RemotePhase;
  /** 直接展示给用户的失败原因。 */
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
