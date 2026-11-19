import { describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '../../../../core/protocol/agent';

// 与 store.test.ts 相同的模式：镜像订阅在模块加载时取 bridge，须先于导入装好。
const runEventListeners = vi.hoisted(() => {
  const listeners: Array<(event: RunEvent) => void> = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: {
        bridge: {
          subscribe: (channel: string, listener: (event: RunEvent) => void) => {
            if (channel === 'agent:run-event') listeners.push(listener);
            return () => {};
          },
        },
      },
    },
  });
  return listeners;
});
import { runBadge, useRuns } from '../runs';

function event(sessionId: string, status: RunEvent['status'], activeTool?: string): RunEvent {
  return { sessionId, runId: 'r1', status, activeTool };
}

describe('runs mirror', () => {
  it('run-event 推送按 sessionId 归并为最新状态', () => {
    useRuns.setState({ bySession: {} });
    runEventListeners[0]!(event('s1', 'pending'));
    runEventListeners[0]!(event('s1', 'running'));
    runEventListeners[0]!(event('s2', 'running'));
    expect(useRuns.getState().bySession['s1']).toEqual({
      runId: 'r1',
      status: 'running',
    });
    expect(useRuns.getState().bySession['s2']?.status).toBe('running');
  });

  it('runBadge：pending/running → running，终态保留，stopped/interrupted 不出徽标', () => {
    expect(runBadge('pending')).toBe('running');
    expect(runBadge('running')).toBe('running');
    expect(runBadge('completed')).toBe('completed');
    expect(runBadge('failed')).toBe('failed');
    expect(runBadge('stopped')).toBeNull();
    expect(runBadge('interrupted')).toBeNull();
    expect(runBadge('waiting_input')).toBeNull();
  });

  it('markSeen 清掉终态记录供导航消徽标，运行中状态保留', () => {
    useRuns.setState({
      bySession: {
        done: { runId: 'r1', status: 'completed' },
        live: { runId: 'r2', status: 'running' },
        stopped: { runId: 'r3', status: 'stopped' },
      },
    });
    useRuns.getState().markSeen('done');
    useRuns.getState().markSeen('live');
    useRuns.getState().markSeen('stopped');
    expect(useRuns.getState().bySession['done']).toBeUndefined();
    expect(useRuns.getState().bySession['stopped']).toBeUndefined();
    expect(useRuns.getState().bySession['live']?.status).toBe('running');
  });
});
