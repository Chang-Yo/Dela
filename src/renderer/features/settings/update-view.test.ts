// 更新状态的展示映射测试：动作、进度与标题栏提示由快照推出，不能靠页面猜。
// 具体措辞不锁死，只验证该有说明的时候不为空，避免改文案就要改测试。
import { describe, expect, it } from 'vitest';
import { pendingUpdate, updateView } from './update';
import type { UpdateReason, UpdateSnapshot } from '../../../shared/update';

const snapshot = (patch: Partial<UpdateSnapshot>): UpdateSnapshot => ({
  phase: 'idle',
  currentVersion: '1.0.0',
  version: null,
  progress: 0,
  transferred: 0,
  total: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
  ...patch,
});

describe('update', () => {
  it('未检查过时只给一个检查入口', () => {
    const view = updateView(snapshot({}));
    expect(view.action).toBe('check');
    expect(view.status).toBeNull();
    expect(view.progress).toBeNull();
  });

  it('检查中不给任何动作', () => {
    expect(updateView(snapshot({ phase: 'checking' })).action).toBeNull();
  });

  it('已是最新时仍可再检查一次', () => {
    expect(updateView(snapshot({ phase: 'up-to-date' })).action).toBe('check');
  });

  it('有更新时给出下载入口', () => {
    const view = updateView(snapshot({ phase: 'available', version: '1.0.1' }));
    expect(view.action).toBe('download');
    expect(view.status).toBeTruthy();
  });

  it('下载中报百分比，并把进度交给进度条', () => {
    const view = updateView(snapshot({ phase: 'downloading', version: '1.0.1', progress: 0.42 }));
    expect(view.progress).toBe(0.42);
    expect(view.action).toBeNull();
  });

  it('下载完成后给出安装入口', () => {
    expect(updateView(snapshot({ phase: 'ready', version: '1.0.1', progress: 1 })).action).toBe(
      'install',
    );
  });

  it('安装中不再给动作', () => {
    expect(updateView(snapshot({ phase: 'installing', version: '1.0.1' })).action).toBeNull();
  });

  it('开发运行不给动作：用户在这里做什么都没用', () => {
    for (const reason of ['not-packaged', 'platform-unsupported'] as const) {
      const view = updateView(snapshot({ phase: 'unsupported', reason, failedAt: 'check' }));
      expect(view.action).toBeNull();
      expect(view.label).toBeNull();
    }
  });

  it('下载失败的重试回到下载，不从头再检查一遍', () => {
    const view = updateView(
      snapshot({ phase: 'error', reason: 'cancelled', failedAt: 'download', version: '1.0.1' }),
    );
    expect(view.action).toBe('download');
  });

  it('安装失败提供手动下载安装包的入口', () => {
    const view = updateView(
      snapshot({ phase: 'error', reason: 'failed', failedAt: 'install', version: '1.0.1' }),
    );
    expect(view.action).toBe('open-download');
  });

  it('没有记录失败步骤时按检查重试，至少不会卡死', () => {
    const view = updateView(snapshot({ phase: 'error', reason: 'failed', failedAt: null }));
    expect(view.action).toBe('check');
  });

  it('每种失败原因都有说明，新增原因不会漏掉展示', () => {
    const reasons: UpdateReason[] = [
      'not-packaged',
      'platform-unsupported',
      'feed-unavailable',
      'invalid-update',
      'cancelled',
      'failed',
    ];
    for (const reason of reasons) {
      for (const phase of ['unsupported', 'error'] as const) {
        const view = updateView(snapshot({ phase, reason, failedAt: 'check' }));
        expect(view.status, `${phase}/${reason}`).toBeTruthy();
      }
    }
  });
});

describe('pendingUpdate', () => {
  it('有待处理的更新时才提示（标题栏图标）', () => {
    const pending: UpdateSnapshot['phase'][] = ['available', 'downloading', 'ready'];
    for (const phase of pending) {
      expect(pendingUpdate(snapshot({ phase })), phase).toBe(true);
    }
  });

  it('没有更新、正在检查或正在安装时不提示', () => {
    const quiet: UpdateSnapshot['phase'][] = [
      'idle',
      'checking',
      'up-to-date',
      'installing',
      'installing',
      'unsupported',
      'error',
    ];
    for (const phase of quiet) {
      expect(pendingUpdate(snapshot({ phase })), phase).toBe(false);
    }
  });
});
