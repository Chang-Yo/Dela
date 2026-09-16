// 首次启动引导流程的持久化状态与自动化短路判定。
// 键值约定：
//   dela.onboarding.completed = '1'  引导已完成（含旧版开屏用户），永不再进入流程
//   dela.onboarding.step      = '0'..'4'  向导进行中的步骤，用于中途退出后续玩
//   两者都不存在                             首次启动，从 Intro 开始

const completedKey = 'dela.onboarding.completed';
const stepKey = 'dela.onboarding.step';
// 旧版一次性开屏的键；视为引导已完成，避免已安装用户重看引导。
const legacySplashKey = 'dela.splash.seen';

// 冒烟与自动化由 main 或各 smoke 脚本在页面 URL 上注入该参数，整个引导直接短路。
export const isSmokeTest = new URLSearchParams(window.location.search).has('smoke-test');

// 开发构建（vite dev server）每次启动都完整重播引导，便于开发期查看与调整；
// 正式构建仍按标记只播一次。
const devReplayOnboarding = import.meta.env.DEV;

export function onboardingCompleted() {
  if (devReplayOnboarding) return false;
  return (
    localStorage.getItem(completedKey) === '1' || localStorage.getItem(legacySplashKey) === '1'
  );
}

/** 向导进行中的步骤；未开始向导时返回 null。开发构建返回 null 以完整重播。 */
export function readWizardStep(): number | null {
  if (devReplayOnboarding) return null;
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
