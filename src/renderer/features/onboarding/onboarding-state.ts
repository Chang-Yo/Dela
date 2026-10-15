// 首次启动由 main 判定，不能仅凭当前页面 origin 下缺少标记推断首次安装。

const completedKey = 'dela.onboarding.completed';
const stepKey = 'dela.onboarding.step';
// 旧版一次性开屏的键；视为引导已完成，避免已安装用户重看引导。
const legacySplashKey = 'dela.splash.seen';
// 全新安装在条款页点了「不同意并退出」；老用户拒绝不必记（见 existingUser）。
const declinedKey = 'dela.onboarding.declined';
const consentKey = 'dela.onboarding.consent';

// 冒烟与自动化由 main 或各 smoke 脚本在页面 URL 上注入该参数，整个引导直接短路。
export const isSmokeTest = new URLSearchParams(window.location.search).has('smoke-test');

/**
 * 条款接受记录：首次启动的条款接受页写入。
 * 只记「接受过」——使用条款第 14 节写明变更后继续使用即视为接受，所以这里不比对版本、
 * 也不在条款改版后要求重新接受；用户当时读到的是哪一版，由应用版本与 docs 里的日期回溯。
 */
export function hasConsent() {
  return localStorage.getItem(consentKey) === '1';
}

export function saveConsent() {
  localStorage.setItem(consentKey, '1');
}

/**
 * 老用户：本次启动之前就已经在用 Dela。条款门只让他们补一次同意，不再走开场与向导。
 *
 * 判据分两类——
 * - 旧版引导留下的痕迹：走完过（`completed`）、进过向导（`step`）、或更早的一次性开屏（`splash`）。
 * - 本次启动前就有数据库（`firstLaunch` 为 false）：清过浏览数据、或渲染层 origin 变过的老安装
 *   只剩一个 dela.db，只能靠这一点认出来。
 *
 * 不能拿「引导有没有开过头」反推新装：上一版的 `started` 标记同样是在全新安装的首次启动写入的，
 * 老用户里也有一批人只留下它，那样会把在用 Dela 的人当成新装、重播开场与向导。反过来，全新安装
 * 一旦拒绝过条款（`declined`）就必须继续算新装，否则下次启动会被当成老用户，一次都没配置就进主界面。
 */
function existingUser() {
  return (
    localStorage.getItem(completedKey) === '1' ||
    localStorage.getItem(stepKey) !== null ||
    localStorage.getItem(legacySplashKey) === '1' ||
    (window.dela?.firstLaunch === false && localStorage.getItem(declinedKey) !== '1')
  );
}

/**
 * 条款页点「不同意并退出」时调用。只有全新安装需要记：老用户下次启动本来就只有条款页要过，
 * 而全新安装下次必须还能走到配置向导（同意条款之后才开始配置个人资料）——那时数据库已经建出来了，
 * 不记这一笔就会被当成在用 Dela 的老用户。
 */
export function markDeclined() {
  if (needsWizard()) localStorage.setItem(declinedKey, '1');
}

/** 同意条款后还要不要走旧配置向导：只有全新安装需要；能力拓展由 App 独立检查。 */
export function needsWizard() {
  return !existingUser();
}

/**
 * 是否跳过原有引导流程。没有接受记录就一定先展示条款页，避免拒绝后重启绕过。
 * 接受过条款后不恢复旧向导；App 仍会检查独立的能力拓展版本。
 */
export function onboardingCompleted() {
  return isSmokeTest || hasConsent();
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
