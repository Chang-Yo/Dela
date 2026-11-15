import type { OnboardingState } from '../contract';
import { onboardingClient } from './client';

// 冒烟与自动化由 main 或各 smoke 脚本在页面 URL 上注入该参数，整个引导直接短路。
export const isSmokeTest = new URLSearchParams(window.location.search).has('smoke-test');

// 开发时用 `VITE_REPLAY_ONBOARDING=1 pnpm dev` 每次启动都完整重播引导，不读本机记录。
const replayOnboarding = import.meta.env.DEV && import.meta.env.VITE_REPLAY_ONBOARDING === '1';

const freshInstall: OnboardingState = { consented: false, completed: false };

/**
 * 只认「接受过」：使用条款第 14 节写明变更后继续使用即视为接受，条款改版不要求重新接受。
 * 浏览器预览没有主进程，按全新安装处理。
 */
export function readOnboardingState(): Promise<OnboardingState> {
  if (replayOnboarding) return Promise.resolve(freshInstall);
  return onboardingClient.state().catch(() => freshInstall);
}
