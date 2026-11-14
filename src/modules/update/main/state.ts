// 更新状态机：纯函数，主进程是唯一持有者，渲染层只读快照。
// 唯一要防守的是迟到与乱序：结果事件只在对应的进行中阶段生效，其余丢弃并原样返回 state。
import type { UpdateReason, UpdateSnapshot, UpdateStep } from '../../shared/update';

export type UpdateEvent =
  | { type: 'check/started' }
  | { type: 'check/available'; version: string; checkedAt: string }
  | { type: 'check/up-to-date'; checkedAt: string }
  | { type: 'check/failed'; reason: UpdateReason; detail?: string | null }
  | { type: 'download/started' }
  | { type: 'download/progress'; progress: number; transferred?: number; total?: number }
  | { type: 'download/finished' }
  | { type: 'download/failed'; reason: UpdateReason; detail?: string | null }
  | { type: 'install/started' }
  | { type: 'install/failed'; reason: UpdateReason; detail?: string | null };

/** 可以重新发起检查的阶段。下载与安装途中不接受新的检查。 */
const CHECKABLE = new Set<UpdateSnapshot['phase']>([
  'idle',
  'up-to-date',
  'available',
  'unsupported',
  'error',
]);

export function initialUpdateState(input: { currentVersion: string }): UpdateSnapshot {
  return {
    phase: 'idle',
    currentVersion: input.currentVersion,
    version: null,
    progress: 0,
    transferred: 0,
    total: null,
    checkedAt: null,
    reason: null,
    detail: null,
    failedAt: null,
  };
}

/** 三个步骤的失败事件只有类型名不同；收敛成一个入口，更新器异常兜底时也不必按步骤各写一遍。 */
export function failureEvent(
  step: UpdateStep,
  reason: UpdateReason,
  detail: string | null,
): UpdateEvent {
  if (step === 'check') return { type: 'check/failed', reason, detail };
  if (step === 'download') return { type: 'download/failed', reason, detail };
  return { type: 'install/failed', reason, detail };
}

export function reduceUpdate(state: UpdateSnapshot, event: UpdateEvent): UpdateSnapshot {
  switch (event.type) {
    case 'check/started': {
      if (!CHECKABLE.has(state.phase)) return state;
      return { ...state, phase: 'checking', reason: null, detail: null, failedAt: null };
    }

    case 'check/available': {
      if (state.phase !== 'checking') return state;
      return {
        ...state,
        phase: 'available',
        version: event.version,
        progress: 0,
        checkedAt: event.checkedAt,
        reason: null,
        detail: null,
      };
    }

    case 'check/up-to-date': {
      if (state.phase !== 'checking') return state;
      return {
        ...state,
        phase: 'up-to-date',
        version: null,
        progress: 0,
        checkedAt: event.checkedAt,
        reason: null,
        detail: null,
      };
    }

    case 'check/failed': {
      if (state.phase !== 'checking') return state;
      return {
        ...state,
        phase: event.reason === 'not-packaged' ? 'unsupported' : 'error',
        version: null,
        progress: 0,
        reason: event.reason,
        detail: event.detail ?? null,
        failedAt: 'check',
      };
    }

    case 'download/started': {
      if (
        state.phase !== 'available' &&
        !(state.phase === 'error' && state.failedAt === 'download')
      ) {
        return state;
      }
      return {
        ...state,
        phase: 'downloading',
        progress: 0,
        transferred: 0,
        total: null,
        reason: null,
        detail: null,
        failedAt: null,
      };
    }

    case 'download/progress': {
      if (state.phase !== 'downloading') return state;
      if (!Number.isFinite(event.progress)) return state;
      const progress = Math.min(1, Math.max(0, event.progress));
      const transferred =
        event.transferred !== undefined &&
        Number.isFinite(event.transferred) &&
        event.transferred >= 0
          ? event.transferred
          : state.transferred;
      const total =
        event.total !== undefined && Number.isFinite(event.total) && event.total > 0
          ? event.total
          : state.total;
      if (progress === state.progress && transferred === state.transferred && total === state.total)
        return state;
      return { ...state, progress, transferred, total };
    }

    case 'download/finished': {
      if (state.phase !== 'downloading') return state;
      return {
        ...state,
        phase: 'ready',
        progress: 1,
        reason: null,
        detail: null,
        failedAt: null,
      };
    }

    case 'download/failed': {
      if (state.phase !== 'downloading') return state;
      return {
        ...state,
        phase: 'error',
        progress: 0,
        transferred: 0,
        total: null,
        reason: event.reason,
        detail: event.detail ?? null,
        failedAt: 'download',
      };
    }

    case 'install/started': {
      if (state.phase !== 'ready' && !(state.phase === 'error' && state.failedAt === 'install')) {
        return state;
      }
      return { ...state, phase: 'installing', reason: null, detail: null, failedAt: null };
    }

    case 'install/failed': {
      if (state.phase !== 'installing') return state;
      return {
        ...state,
        phase: 'error',
        progress: 0,
        reason: event.reason,
        detail: event.detail ?? null,
        failedAt: 'install',
      };
    }

    default:
      return state;
  }
}
