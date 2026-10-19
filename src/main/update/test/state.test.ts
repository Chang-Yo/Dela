// 更新状态机的纯逻辑测试。状态机不碰 Electron、不碰更新器，
// 它要保证的核心只有一件事：任何迟到或乱序的事件都不能把状态改回错误的阶段。
import { describe, expect, it } from 'vitest';
import { failureEvent, initialUpdateState, reduceUpdate, type UpdateEvent } from '../state';
import type { UpdateSnapshot, UpdateStep } from '../../../shared/update';

const at = '2026-10-12T00:00:00.000Z';

const base = () => initialUpdateState({ currentVersion: '1.0.0' });

const run = (state: UpdateSnapshot, events: UpdateEvent[]) => events.reduce(reduceUpdate, state);

const reachedAvailable = (version = '1.0.1') =>
  run(base(), [{ type: 'check/started' }, { type: 'check/available', version, checkedAt: at }]);

it('差分回退时进度与传输量同步重置，重试清空旧传输量', () => {
  const first = run(reachedAvailable(), [
    { type: 'download/started' },
    { type: 'download/progress', progress: 0.6, transferred: 60, total: 100 },
  ]);
  const slower = reduceUpdate(first, {
    type: 'download/progress',
    progress: 0.2,
    transferred: 40,
    total: 200,
  });
  expect(slower).toMatchObject({ progress: 0.2, transferred: 40, total: 200 });
  const failed = reduceUpdate(slower, { type: 'download/failed', reason: 'failed' });
  expect(reduceUpdate(failed, { type: 'download/started' })).toMatchObject({
    transferred: 0,
    total: null,
  });
});

describe('检查', () => {
  it('有更新时进入 available 并带上版本', () => {
    const state = reachedAvailable('1.0.1');
    expect(state.phase).toBe('available');
    expect(state.version).toBe('1.0.1');
    expect(state.checkedAt).toBe(at);
    expect(state.reason).toBeNull();
  });

  it('无更新时进入 up-to-date 并记录检查时刻', () => {
    const state = run(base(), [
      { type: 'check/started' },
      { type: 'check/up-to-date', checkedAt: at },
    ]);
    expect(state.phase).toBe('up-to-date');
    expect(state.checkedAt).toBe(at);
    expect(state.version).toBeNull();
  });

  it('失败时进入 unsupported 并保留原因与排查细节', () => {
    const state = run(base(), [
      { type: 'check/started' },
      { type: 'check/failed', reason: 'not-packaged', detail: 'raw' },
    ]);
    expect(state.phase).toBe('unsupported');
    expect(state.reason).toBe('not-packaged');
    expect(state.detail).toBe('raw');
  });

  it('更新源暂时不可用是可重试的失败，不是能力缺失', () => {
    const state = run(base(), [
      { type: 'check/started' },
      { type: 'check/failed', reason: 'feed-unavailable', detail: null },
    ]);
    expect(state.phase).toBe('error');
    expect(state.reason).toBe('feed-unavailable');
  });

  it('检查中重复的开始事件被忽略', () => {
    const checking = run(base(), [{ type: 'check/started' }]);
    expect(checking.phase).toBe('checking');
    expect(reduceUpdate(checking, { type: 'check/started' })).toBe(checking);
  });

  it('下载已经开始后，迟到的检查结果不得改变状态', () => {
    const downloading = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/progress', progress: 0.4 },
    ]);
    const late = reduceUpdate(downloading, {
      type: 'check/available',
      version: '9.9.9',
      checkedAt: at,
    });
    expect(late).toBe(downloading);
  });

  it('已经最新之后仍可再次检查', () => {
    const upToDate = run(base(), [
      { type: 'check/started' },
      { type: 'check/up-to-date', checkedAt: at },
    ]);
    expect(reduceUpdate(upToDate, { type: 'check/started' }).phase).toBe('checking');
  });
});

describe('下载', () => {
  it('尚未发现更新时不能开始下载', () => {
    const idle = base();
    expect(reduceUpdate(idle, { type: 'download/started' })).toBe(idle);
    const upToDate = run(base(), [
      { type: 'check/started' },
      { type: 'check/up-to-date', checkedAt: at },
    ]);
    expect(reduceUpdate(upToDate, { type: 'download/started' })).toBe(upToDate);
  });

  it('下载进度夹在 0..1，达到 100% 不等于已准备好安装', () => {
    const state = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/progress', progress: 0.6 },
      { type: 'download/progress', progress: 0.2 },
      { type: 'download/progress', progress: 4 },
    ]);
    expect(state.progress).toBe(1);
    expect(state.phase).toBe('downloading');
  });

  it('非有限数的进度被忽略', () => {
    const state = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/progress', progress: 0.5 },
      { type: 'download/progress', progress: Number.NaN },
    ]);
    expect(state.progress).toBe(0.5);
  });

  it('下载完成进入 ready 并保留目标版本', () => {
    const state = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/progress', progress: 1 },
      { type: 'download/finished' },
    ]);
    expect(state.phase).toBe('ready');
    expect(state.version).toBe('1.0.1');
    expect(state.progress).toBe(1);
  });

  it('ready 阶段不能重复下载', () => {
    const ready = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/finished' },
    ]);
    expect(reduceUpdate(ready, { type: 'download/started' })).toBe(ready);
  });

  it('下载失败后，迟到的进度与完成事件都不得把状态拉回下载中', () => {
    const failed = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/failed', reason: 'cancelled', detail: null },
    ]);
    expect(failed.phase).toBe('error');
    expect(reduceUpdate(failed, { type: 'download/progress', progress: 0.9 })).toBe(failed);
    expect(reduceUpdate(failed, { type: 'download/finished' })).toBe(failed);
  });

  it('取消下载后进度归零，也可重新检查', () => {
    const failed = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/progress', progress: 0.3 },
      { type: 'download/failed', reason: 'cancelled', detail: null },
    ]);
    expect(failed.progress).toBe(0);
    expect(reduceUpdate(failed, { type: 'check/started' }).phase).toBe('checking');
  });
});

describe('安装', () => {
  const ready = () =>
    run(reachedAvailable(), [{ type: 'download/started' }, { type: 'download/finished' }]);

  it('尚未下载完成时不能开始安装', () => {
    const available = reachedAvailable();
    expect(reduceUpdate(available, { type: 'install/started' })).toBe(available);
  });

  it('启动安装后保持 installing，不提前宣称完成', () => {
    const state = run(ready(), [{ type: 'install/started' }]);
    expect(state.phase).toBe('installing');
    expect(state.version).toBe('1.0.1');
  });

  it('安装失败进入 error 并保留原因', () => {
    const state = run(ready(), [
      { type: 'install/started' },
      { type: 'install/failed', reason: 'failed', detail: null },
    ]);
    expect(state.phase).toBe('error');
    expect(state.reason).toBe('failed');
  });

  it('安装中到达的下载事件被忽略', () => {
    const installing = run(ready(), [{ type: 'install/started' }]);
    expect(reduceUpdate(installing, { type: 'download/progress', progress: 0.2 })).toBe(installing);
    expect(reduceUpdate(installing, { type: 'download/started' })).toBe(installing);
  });
});

describe('失败步骤', () => {
  it('检查失败记在检查这一步', () => {
    const state = run(base(), [
      { type: 'check/started' },
      { type: 'check/failed', reason: 'not-packaged', detail: null },
    ]);
    expect(state.failedAt).toBe('check');
  });

  it('下载失败记在下载这一步，目标版本仍保留', () => {
    const state = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/failed', reason: 'cancelled', detail: null },
    ]);
    expect(state.failedAt).toBe('download');
    expect(state.version).toBe('1.0.1');
  });

  it('安装失败记在安装这一步', () => {
    const ready = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/finished' },
    ]);
    const state = run(ready, [
      { type: 'install/started' },
      { type: 'install/failed', reason: 'failed', detail: null },
    ]);
    expect(state.failedAt).toBe('install');
  });

  it('重新进入进行中的阶段就清掉上一次的失败步骤', () => {
    const failed = run(reachedAvailable(), [
      { type: 'download/started' },
      { type: 'download/failed', reason: 'failed', detail: null },
    ]);
    expect(failed.failedAt).toBe('download');
    expect(reduceUpdate(failed, { type: 'check/started' }).failedAt).toBeNull();
  });

  it('检查成功后不留下失败步骤', () => {
    expect(reachedAvailable().failedAt).toBeNull();
  });
});

describe('failureEvent', () => {
  it('按失败步骤给出对应的事件类型', () => {
    expect(failureEvent('check', 'failed', 'x')).toEqual({
      type: 'check/failed',
      reason: 'failed',
      detail: 'x',
    });
    expect(failureEvent('download', 'cancelled', null)).toEqual({
      type: 'download/failed',
      reason: 'cancelled',
      detail: null,
    });
    expect(failureEvent('install', 'failed', null)).toEqual({
      type: 'install/failed',
      reason: 'failed',
      detail: null,
    });
  });

  it('进行中的三个阶段都能被自己的失败事件解除，不会永远卡在进行中', () => {
    const steps: UpdateStep[] = ['check', 'download', 'install'];
    const inFlight: Record<UpdateStep, UpdateSnapshot> = {
      check: run(base(), [{ type: 'check/started' }]),
      download: run(reachedAvailable(), [{ type: 'download/started' }]),
      install: run(reachedAvailable(), [
        { type: 'download/started' },
        { type: 'download/finished' },
        { type: 'install/started' },
      ]),
    };
    for (const step of steps) {
      const escaped = reduceUpdate(inFlight[step], failureEvent(step, 'failed', '更新器抛了异常'));
      expect(escaped.phase, step).toBe('error');
      expect(escaped.failedAt, step).toBe(step);
    }
  });
});
