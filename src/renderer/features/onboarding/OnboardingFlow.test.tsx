// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../shared/api';
import { OnboardingFlow } from './OnboardingFlow';

const state = vi.hoisted(() => ({ mark: vi.fn() }));
vi.mock('./onboarding-state', () => ({
  needsWizard: () => true,
  hasConsent: () => true,
  readWizardStep: () => null,
  saveWizardStep: vi.fn(),
  saveConsent: vi.fn(),
  markOnboardingCompleted: state.mark,
}));
vi.mock('framer-motion', () => ({
  MotionConfig: ({ children }: { children: ReactNode }) => children,
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  },
}));
vi.mock('./IntroSequence', () => ({
  IntroSequence: ({ onStart }: { onStart: () => void }) => <button onClick={onStart}>开始</button>,
}));
vi.mock('./steps/MailStep', () => ({ MailStep: () => <h2>邮箱步骤</h2> }));
vi.mock('./steps/CampusStep', () => ({ CampusStep: () => <h2>课表步骤</h2> }));
vi.mock('./steps/CanvasStep', () => ({ CanvasStep: () => <h2>Canvas 步骤</h2> }));
vi.mock('./steps/ShuiyuanStep', () => ({ ShuiyuanStep: () => <h2>水源步骤</h2> }));
vi.mock('./steps/LlmStep', () => ({ LlmStep: () => <h2>模型步骤</h2> }));

it('keeps capability setup inside the six-step wizard, supports going back, and completes only on confirmation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const completeSetup = vi.fn(async () => {});
  window.dela = {
    capability: { listSkills: async () => [], completeSetup },
    window: { minimize: vi.fn(), close: vi.fn() },
  } as unknown as DelaApi;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const done = vi.fn();
  const consentDone = vi.fn();
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)!;
  try {
    await act(async () =>
      root.render(<OnboardingFlow onWizardDone={done} onConsentDone={consentDone} />),
    );
    await act(async () => button('开始').click());
    const shell = host.firstElementChild;
    for (let index = 0; index < 5; index++) await act(async () => button('跳过').click());
    expect(host.firstElementChild).toBe(shell);
    expect(host.textContent).toContain('能力拓展');
    expect(host.querySelector('[aria-label="第 6 步，共 6 步"]')).not.toBeNull();
    expect(done).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
    await act(async () => button('上一步').click());
    expect(host.textContent).toContain('模型步骤');
    expect(host.querySelector('[aria-label="第 5 步，共 6 步"]')).not.toBeNull();
    expect(completeSetup).not.toHaveBeenCalled();
    await act(async () => button('跳过').click());
    await act(async () => button('完成配置').click());
    expect(completeSetup).toHaveBeenCalledOnce();
    expect(state.mark).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
    expect(consentDone).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    delete window.dela;
    vi.unstubAllGlobals();
  }
});
