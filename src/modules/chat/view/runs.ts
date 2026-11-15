import { create } from 'zustand';
import { onAgentEvent } from './client';
import type { RunEvent, RunStatus } from '../../../core/protocol/agent';

// Run 状态镜像：按 sessionId 归并 run-event 推送，供导航行徽标与 ChatTab 共用；
// 只订阅，不发起执行。

export interface RunMirror {
  runId: string;
  status: RunStatus;
}

/** 事件归并：同一 session 的最新事件覆盖旧状态（主进程对同一 session 串行，IPC 保序）。 */
export function applyRunEvent(
  bySession: Record<string, RunMirror>,
  event: RunEvent,
): Record<string, RunMirror> {
  return {
    ...bySession,
    [event.sessionId]: {
      runId: event.runId,
      status: event.status,
    },
  };
}

/** 徽标映射：运行中实时；终态（completed/failed）保留供导航提示已产生的结果；
 *  stopped 为用户主动停止、interrupted 仅启动时写入、waiting_input 本轮不触发，均不出徽标。 */
export function runBadge(status: RunStatus): 'running' | 'failed' | 'completed' | null {
  if (status === 'pending' || status === 'running') return 'running';
  if (status === 'completed' || status === 'failed') return status;
  return null;
}

interface RunsState {
  bySession: Record<string, RunMirror>;
  /** 正开着的会话视图数：开着的视图看到终态即视为已读。 */
  viewing: Record<string, number>;
  apply: (event: RunEvent) => void;
  startViewing: (sessionId: string) => void;
  stopViewing: (sessionId: string) => void;
  /** 会话结果已被某个视图看到：清掉终态记录（徽标消失）；运行中的状态不受影响。 */
  markSeen: (sessionId: string) => void;
}

function isSettled(status: RunStatus): boolean {
  const badge = runBadge(status);
  return badge !== null && badge !== 'running';
}

export const useRuns = create<RunsState>((set, get) => ({
  bySession: {},
  viewing: {},
  apply: (event) => {
    set((state) => ({ bySession: applyRunEvent(state.bySession, event) }));
    if (isSettled(event.status) && isSessionViewed(event.sessionId))
      get().markSeen(event.sessionId);
  },
  startViewing: (sessionId) => {
    set((state) => ({
      viewing: { ...state.viewing, [sessionId]: (state.viewing[sessionId] ?? 0) + 1 },
    }));
    const run = get().bySession[sessionId];
    if (run && isSettled(run.status)) get().markSeen(sessionId);
  },
  stopViewing: (sessionId) =>
    set((state) => ({
      viewing: { ...state.viewing, [sessionId]: (state.viewing[sessionId] ?? 1) - 1 },
    })),
  markSeen: (sessionId) =>
    set((state) => {
      const run = state.bySession[sessionId];
      if (!run || runBadge(run.status) === 'running') return state;
      const bySession = { ...state.bySession };
      delete bySession[sessionId];
      return { bySession };
    }),
}));

export function isSessionViewed(sessionId: string): boolean {
  return (useRuns.getState().viewing[sessionId] ?? 0) > 0;
}

/** 会话徽标的即时读取（导航行等一次性判定）；需要随推送刷新的界面用 useRuns 选择器订阅。 */
export function sessionRunBadge(sessionId: string): 'running' | 'failed' | 'completed' | null {
  const run = useRuns.getState().bySession[sessionId];
  return run ? runBadge(run.status) : null;
}

/** 按行订阅某会话的 run 状态原始值：applyRunEvent 只替换目标键，其余会话的行不重渲
 *  （导航徽标用；App 层不再订阅 bySession 对象，避免每个 run 事件全 App 重渲）。 */
export function useSessionRunStatus(sessionId: string): RunStatus | null {
  return useRuns((state) => state.bySession[sessionId]?.status ?? null);
}

/** 模块加载即订阅 run 状态推送。 */
onAgentEvent('run-event', useRuns.getState().apply);
