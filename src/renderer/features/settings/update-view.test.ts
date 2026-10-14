// 更新状态的展示映射测试：文案、可用动作与标题栏提示都必须由快照推出，不能靠页面猜。
import { describe, expect, it } from 'vitest';
import { pendingUpdate, updateView } from './updateView';
import type { UpdateReason, UpdateSnapshot } from '../../../shared/update';

const snapshot = (patch: Partial<UpdateSnapshot>): UpdateSnapshot => ({
  phase: 'idle',
  currentVersion: '1.0.0',
  version: null,
  progress: 0,
  bytesPerSecond: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
  ...patch,
});

describe('updateView', () => {
  it('未检查过时只给一个检查入口', () => {
    expect(updateView(snapshot({}))).toEqual({
      status: null,
      action: 'check',
      label: '检查更新',
      progress: null,
    });
  });

  it('检查中不给任何动作', () => {
    expect(updateView(snapshot({ phase: 'checking' })).action).toBeNull();
  });

  it('已是最新时仍可再检查一次', () => {
    const view = updateView(snapshot({ phase: 'up-to-date' }));
    expect(view.status).toBe('已是最新版本');
    expect(view.action).toBe('check');
  });

  it('有更新时把目标版本写进文案', () => {
    const view = updateView(snapshot({ phase: 'available', version: '1.0.1' }));
    expect(view.status).toBe('有新版本 1.0.1');
    expect(view.action).toBe('download');
  });

  it('下载中报百分比，并把进度交给进度条', () => {
    const view = updateView(snapshot({ phase: 'downloading', version: '1.0.1', progress: 0.42 }));
    expect(view.status).toBe('正在下载更新');
    expect(view.progress).toBe(0.42);
    expect(view.action).toBeNull();
  });

  it('下载完成后说明安装会让应用退出', () => {
    const view = updateView(snapshot({ phase: 'ready', version: '1.0.1', progress: 1 }));
    expect(view.status).toContain('退出 Dela 并打开安装向导');
    expect(view.action).toBe('install');
    expect(view.label).toBe('安装更新');
  });

  it('安装中提醒应用即将关闭，并不再给动作', () => {
    const view = updateView(snapshot({ phase: 'installing', version: '1.0.1' }));
    expect(view.status).toContain('正在打开安装向导');
    expect(view.status).toContain('Dela 即将退出');
    expect(view.action).toBeNull();
  });

  it('开发运行不给动作：用户在这里做什么都没用', () => {
    for (const reason of ['not-packaged'] as const) {
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
    expect(view.label).toBe('重试');
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

  it('每种失败原因都有文案，新增原因不会漏掉展示', () => {
    const reasons: UpdateReason[] = [
      'not-packaged',
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

  it('失败虽然有原因，但不该在标题栏常亮一个提示', () => {
    expect(pendingUpdate(snapshot({ phase: 'error', reason: 'failed', failedAt: 'check' }))).toBe(
      false,
    );
  });
});
