// 更新状态的展示映射测试：文案、可用动作与标题栏提示都必须由快照推出，不能靠页面猜。
import { describe, expect, it } from 'vitest';
import { pendingUpdate, updateView } from './updateView';
import type { UpdateReason, UpdateSnapshot } from '../../../shared/update';

const snapshot = (patch: Partial<UpdateSnapshot>): UpdateSnapshot => ({
  phase: 'idle',
  channel: 'store',
  currentVersion: '1.0.0',
  version: null,
  mandatory: false,
  progress: 0,
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

  it('商店标记为重要更新时只说重要，不承诺强制', () => {
    // 商店不会替我们强制，Dela 也没做任何禁用逻辑，所以文案不能写成「必须更新」。
    const view = updateView(snapshot({ phase: 'available', version: '1.0.1', mandatory: true }));
    expect(view.status).toBe('有新版本 1.0.1（重要更新）');
  });

  it('下载中报百分比，并把进度交给进度条', () => {
    const view = updateView(snapshot({ phase: 'downloading', version: '1.0.1', progress: 0.42 }));
    expect(view.status).toBe('正在下载 42%');
    expect(view.progress).toBe(0.42);
    expect(view.action).toBeNull();
  });

  it('下载完成后说明安装会让应用退出', () => {
    // 安装期间系统会终止 Dela，且不保证自动重启，文案要提前说清。
    const view = updateView(snapshot({ phase: 'ready', version: '1.0.1', progress: 1 }));
    expect(view.status).toBe('更新已下载，安装时 Dela 会关闭');
    expect(view.action).toBe('install');
    expect(view.label).toBe('安装更新');
  });

  it('安装中提醒应用即将关闭，并不再给动作', () => {
    const view = updateView(snapshot({ phase: 'installing', version: '1.0.1' }));
    expect(view.status).toBe('正在安装，Dela 即将关闭');
    expect(view.action).toBeNull();
  });

  it('安装完成后提醒重新打开', () => {
    const view = updateView(snapshot({ phase: 'installed', version: '1.0.1' }));
    expect(view.status).toBe('更新已安装，请重新打开 Dela');
    expect(view.action).toBeNull();
  });

  it('非商店安装引导去商店，而不是让用户反复重试', () => {
    const view = updateView(
      snapshot({ phase: 'unsupported', reason: 'not-store', failedAt: 'check' }),
    );
    expect(view.action).toBe('open-store');
    expect(view.label).toBe('前往商店');
  });

  it('商店不认识这个包时同样引导去商店', () => {
    const view = updateView(
      snapshot({ phase: 'unsupported', reason: 'store-unknown', failedAt: 'check' }),
    );
    expect(view.action).toBe('open-store');
  });

  it('开发运行与缺少更新组件时不给动作：用户在这里做什么都没用', () => {
    for (const reason of ['not-packaged', 'addon-missing'] as const) {
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

  it('安装失败的重试回到安装', () => {
    const view = updateView(
      snapshot({ phase: 'error', reason: 'low-battery', failedAt: 'install', version: '1.0.1' }),
    );
    expect(view.action).toBe('install');
  });

  it('没有记录失败步骤时按检查重试，至少不会卡死', () => {
    const view = updateView(snapshot({ phase: 'error', reason: 'failed', failedAt: null }));
    expect(view.action).toBe('check');
  });

  it('每种失败原因都有文案，新增原因不会漏掉展示', () => {
    const reasons: UpdateReason[] = [
      'not-packaged',
      'not-store',
      'store-unknown',
      'store-unavailable',
      'addon-missing',
      'window-handle',
      'cancelled',
      'low-battery',
      'wifi-required',
      'wifi-recommended',
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

  it('没有更新、正在检查或已装完都不提示', () => {
    const quiet: UpdateSnapshot['phase'][] = [
      'idle',
      'checking',
      'up-to-date',
      'installing',
      'installed',
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
