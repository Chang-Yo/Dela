// 首次启动由 main 判定，不能仅凭当前页面 origin 下缺少标记推断首次安装。

const completedKey = 'dela.onboarding.completed';
const stepKey = 'dela.onboarding.step';
// 旧版一次性开屏的键；视为引导已完成，避免已安装用户重看引导。
const legacySplashKey = 'dela.splash.seen';
const startedKey = 'dela.onboarding.started';

// 冒烟与自动化由 main 或各 smoke 脚本在页面 URL 上注入该参数，整个引导直接短路。
export const isSmokeTest = new URLSearchParams(window.location.search).has('smoke-test');

// 在 React 挂载前保存本次启动决定，避免 StrictMode 重复初始化改变结果。
// started 在播放前写入，首次引导中途退出或刷新也不再重播。
const skipOnboarding =
  isSmokeTest ||
  window.dela?.firstLaunch === false ||
  localStorage.getItem(startedKey) === '1' ||
  localStorage.getItem(completedKey) === '1' ||
  localStorage.getItem(legacySplashKey) === '1' ||
  localStorage.getItem(stepKey) !== null;

if (!skipOnboarding) localStorage.setItem(startedKey, '1');

export function onboardingCompleted() {
  return skipOnboarding || localStorage.getItem(completedKey) === '1';
}

/** 当前向导步骤；新启动不再恢复未完成的引导。 */
export function readWizardStep(): number | null {
  const raw = localStorage.getItem(stepKey);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function saveWizardStep(step: number) {
  localStorage.setItem(stepKey, String(step));
}

export function markOnboardingCompleted() {
  localStorage.setItem(completedKey, '1');
  localStorage.removeItem(stepKey);
}
