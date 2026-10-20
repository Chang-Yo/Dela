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
  it('全新安装：完整引导', async () => {
    const state = await import('./onboarding-state');
    // 模块求值本身不写任何引导标记：只有用户在条款页点了不同意才记一笔。
    expect(localStorage.getItem('dela.onboarding.declined')).toBeNull();
    expect(state.needsWizard()).toBe(true);
    expect(state.onboardingCompleted()).toBe(false);
  });

  it('老用户同意条款后直接进主界面，不走向导', async () => {
    Object.defineProperty(window, 'dela', { value: { firstLaunch: false } });
    localStorage.setItem('dela.onboarding.completed', '1');
    const state = await import('./onboarding-state');
    // 升级后先补条款：还不算完成引导，但不再需要向导。
    expect(state.needsWizard()).toBe(false);
    expect(state.onboardingCompleted()).toBe(false);
    state.saveConsent();
    expect(state.onboardingCompleted()).toBe(true);
  });

  it('停在向导中途的老用户同样只补条款', async () => {
    localStorage.setItem('dela.onboarding.step', '0');
    const state = await import('./onboarding-state');
    expect(state.needsWizard()).toBe(false);
    expect(state.onboardingCompleted()).toBe(false);
    state.saveConsent();
    expect(state.onboardingCompleted()).toBe(true);
  });

  it('更早的一次性开屏用户也只补条款', async () => {
    localStorage.setItem('dela.splash.seen', '1');
    const state = await import('./onboarding-state');
    expect(state.needsWizard()).toBe(false);
    expect(state.onboardingCompleted()).toBe(false);
  });

  it('清过浏览数据的老安装（有数据库、没有引导标记）也只补条款', async () => {
    Object.defineProperty(window, 'dela', { value: { firstLaunch: false } });
    const state = await import('./onboarding-state');
    expect(state.needsWizard()).toBe(false);
    expect(state.onboardingCompleted()).toBe(false);
  });

  it('只留下上一版 started 痕迹的老安装也只补条款', async () => {
    // 上一版把 started 记为「引导已完成」，所以有一批在用 Dela 的人身上只有这一个标记。
    // 拿它反推「本 profile 没跑过引导 = 新装」会让这些人重看开场动画和五步向导。
    localStorage.setItem('dela.onboarding.started', '1');
    Object.defineProperty(window, 'dela', { value: { firstLaunch: false } });
    const state = await import('./onboarding-state');
    expect(state.needsWizard()).toBe(false);
  });

  it('全新安装拒绝条款后再打开仍走完整引导', async () => {
    // 拒绝之后数据库已经建好，下次启动只看 firstLaunch 就会被当成老用户，
    // 一次都没配置过就被丢进主界面——所以拒绝这一笔必须记下来。
    const state = await import('./onboarding-state');
    state.markDeclined();
    Object.defineProperty(window, 'dela', { value: { firstLaunch: false } });
    expect(state.needsWizard()).toBe(true);
    expect(state.onboardingCompleted()).toBe(false);
  });

  it('老用户拒绝条款不记标记，下次仍然只补条款', async () => {
    Object.defineProperty(window, 'dela', { value: { firstLaunch: false } });
    localStorage.setItem('dela.onboarding.completed', '1');
    const state = await import('./onboarding-state');
    state.markDeclined();
    // 老用户本来就只有条款页要过，记下来反而会在下次启动重新走一遍向导。
    expect(localStorage.getItem('dela.onboarding.declined')).toBeNull();
    expect(state.needsWizard()).toBe(false);
  });

  it('冒烟跳过且不写任何引导标记', async () => {
    window.location.search = '?smoke-test=1';
    const state = await import('./onboarding-state');
    expect(state.onboardingCompleted()).toBe(true);
    expect(state.hasConsent()).toBe(false);
    expect(localStorage.getItem('dela.onboarding.declined')).toBeNull();
  });

  it('完成后清除步骤并跳过', async () => {
    const state = await import('./onboarding-state');
    state.saveConsent();
    state.saveWizardStep(4);
    state.markOnboardingCompleted();
    expect(state.onboardingCompleted()).toBe(true);
    expect(state.readWizardStep()).toBeNull();
  });
});
