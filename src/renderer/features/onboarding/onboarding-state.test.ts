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
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('首次启动引导', () => {
  it('全新安装：完整引导', async () => {
    const state = await import('./onboarding-state');
    expect(state.needsWizard()).toBe(true);
    expect(state.onboardingCompleted()).toBe(false);
  });

  it('已完成向导仍需有条款接受记录才能进入主界面', async () => {
    localStorage.setItem('dela.onboarding.completed', '1');
    const state = await import('./onboarding-state');
    expect(state.needsWizard()).toBe(false);
    expect(state.onboardingCompleted()).toBe(false);
    state.saveConsent();
    expect(state.onboardingCompleted()).toBe(true);
  });

  it('冒烟跳过且不写任何引导标记', async () => {
    window.location.search = '?smoke-test=1';
    const state = await import('./onboarding-state');
    expect(state.onboardingCompleted()).toBe(true);
    expect(state.hasConsent()).toBe(false);
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
