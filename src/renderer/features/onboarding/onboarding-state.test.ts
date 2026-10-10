import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', {
    location: { search: '' },
    dela: { firstLaunch: true },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('首次启动引导', () => {
  it('首次启动显示，重复读取启动决定不受已写入标记影响', async () => {
    const state = await import('./onboarding-state');
    expect(state.onboardingCompleted()).toBe(false);
    expect(state.onboardingCompleted()).toBe(false);
    expect(localStorage.getItem('dela.onboarding.started')).toBe('1');
  });

  it('动画中途刷新或重启也跳过', async () => {
    await import('./onboarding-state');
    vi.resetModules();
    const state = await import('./onboarding-state');
    expect(state.onboardingCompleted()).toBe(true);
  });

  it('旧安装更新或重启，即使页面存储为空也跳过', async () => {
    Object.defineProperty(window, 'dela', { value: { firstLaunch: false } });
    const state = await import('./onboarding-state');
    expect(state.onboardingCompleted()).toBe(true);
  });

  it.each([
    ['dela.splash.seen', '1'],
    ['dela.onboarding.step', '0'],
  ])('兼容已有标记 %s=%s', async (key, value) => {
    localStorage.setItem(key, value);
    const state = await import('./onboarding-state');
    expect(state.onboardingCompleted()).toBe(true);
  });

  it('冒烟跳过且不写入首次播放标记', async () => {
    window.location.search = '?smoke-test=1';
    const state = await import('./onboarding-state');
    expect(state.onboardingCompleted()).toBe(true);
    expect(localStorage.getItem('dela.onboarding.started')).toBeNull();
  });

  it('完成后清除步骤并跳过', async () => {
    const state = await import('./onboarding-state');
    state.saveWizardStep(4);
    state.markOnboardingCompleted();
    expect(state.onboardingCompleted()).toBe(true);
    expect(state.readWizardStep()).toBeNull();
  });
});
