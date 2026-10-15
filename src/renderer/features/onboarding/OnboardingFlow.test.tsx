// @vitest-environment jsdom
// 引导编排：新装用户先看开场动画，老用户升级后只过一次条款页——同意完直接进主界面，
// 不放开场动画、也不播「配置完成」收尾动画。分类判据都在 onboarding-state.ts。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** 启动判据在模块求值时定下，所以每个用例都重新导入。 */
async function renderFlow() {
  vi.resetModules();
  const { OnboardingFlow } = await import('./OnboardingFlow');
  const onConsentDone = vi.fn();
  const onWizardDone = vi.fn();
  await act(async () =>
    root.render(<OnboardingFlow onConsentDone={onConsentDone} onWizardDone={onWizardDone} />),
  );
  return { onConsentDone, onWizardDone };
}

function button(text: string) {
  const element = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`找不到按钮：${text}`);
  return element;
}

function intro() {
  return container.querySelector('[data-onboarding-intro]');
}

function hasButton(text: string) {
  return [...container.querySelectorAll('button')].some((item) => item.textContent?.includes(text));
}

function consent() {
  return container.querySelector('[data-consent-text]');
}

/** 向导进度点用「第 N 步，共 M 步」标注，是「已经进到向导」最稳的判据。 */
function wizardStep(step = 1) {
  return container.querySelector(`[role="group"][aria-label="第 ${step} 步，共 5 步"]`);
}

function consentRecords() {
  const record = window.dela?.consent.record as unknown as { mock: { calls: unknown[][] } };
  return record.mock.calls;
}

/** 开场动画退场是 0.35s 的真实过渡，jsdom 里按真实计时器等它走完。 */
async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  }
  throw new Error('等待界面变化超时');
}

/** 预加载接口的最小可用形态：条款页会用到 window、consent 与 backup 三个域。 */
function stubDela(firstLaunch: boolean) {
  const dela = {
    firstLaunch,
    consent: { record: vi.fn().mockResolvedValue(undefined) },
    backup: { exportData: vi.fn().mockResolvedValue({ status: 'cancelled' }) },
    window: { quit: vi.fn(), close: vi.fn() },
  };
  vi.stubGlobal('dela', dela);
  return dela;
}

// 开场动画要挂载真实的时间线与 framer-motion，冷启动比默认 5s 慢得多，慢了会让后续渲染
// 一起拿不到提交机会、报出与真实原因无关的错。
it('全新安装：先放开场动画，还没到条款页', { timeout: 15000 }, async () => {
  stubDela(true);
  await renderFlow();

  expect(intro()).not.toBeNull();
  expect(consent()).toBeNull();
  // 全新安装没有可导出的本机数据，给这个出口只会让人以为有东西。
  expect(hasButton('导出本机数据')).toBe(false);
});

it('全新安装：两份条款都同意后进入配置向导', { timeout: 15000 }, async () => {
  const dela = stubDela(true);
  const { onConsentDone, onWizardDone } = await renderFlow();

  await act(async () => button('跳过').click());
  await waitFor(() => consent() !== null);
  expect(intro()).toBeNull();

  await act(async () => button('同意并继续').click());
  // 换到第二份条款：内容换了，门禁也重新上锁。
  expect(consent()?.getAttribute('aria-label')).toBe('隐私条款正文');
  await act(async () => button('同意并继续').click());

  // 真的离开了条款页，进到五步向导的第一步。
  expect(consent()).toBeNull();
  expect(wizardStep(1)).not.toBeNull();
  // 两份条款各留一条接受记录，内容与主进程的约束一致。
  expect(dela.consent.record.mock.calls).toEqual([
    ['terms', '2026-10-15'],
    ['privacy', '2026-10-15'],
  ]);
  expect(localStorage.getItem('dela.onboarding.consent')).toBe('1');
  // 新装走的是向导，不是「老用户补条款」这条捷径。
  expect(onConsentDone).not.toHaveBeenCalled();
  expect(onWizardDone).not.toHaveBeenCalled();
});

it('新装拒绝条款后再打开：仍走完整引导，不被当成老用户', { timeout: 15000 }, async () => {
  // 点过「不同意并退出」之后数据库已经建好，拒绝这一笔由 markDeclined 记下来。
  localStorage.setItem('dela.onboarding.declined', '1');
  stubDela(false);
  await renderFlow();

  expect(intro()).not.toBeNull();
  expect(consent()).toBeNull();
});

it('老用户升级后只补条款：不放开场，同意完直接进主界面', { timeout: 15000 }, async () => {
  localStorage.setItem('dela.onboarding.completed', '1');
  stubDela(false);
  const { onConsentDone, onWizardDone } = await renderFlow();

  expect(intro()).toBeNull();
  expect(consent()).not.toBeNull();
  // 本机已经有数据，先给一个把数据拿走的出口，再谈同意与否。
  expect(hasButton('导出本机数据')).toBe(true);

  // 两份条款依次同意（jsdom 无布局，内容按「放得下」判定，按钮即可用）。
  await act(async () => button('同意并继续').click());
  await act(async () => button('同意并继续').click());

  expect(onConsentDone).toHaveBeenCalledTimes(1);
  // 老用户没有向导要跑，也就不该播「配置完成」动画。
  expect(onWizardDone).not.toHaveBeenCalled();
  expect(wizardStep(1)).toBeNull();
  expect(localStorage.getItem('dela.onboarding.consent')).toBe('1');
  expect(consentRecords()).toHaveLength(2);
});

it('清过浏览数据的老安装：同样只补条款，不从开头痛一遍引导', { timeout: 15000 }, async () => {
  // 有数据库（firstLaunch 为 false）但 localStorage 空——渲染层 origin 变过或存储被清过。
  stubDela(false);
  await renderFlow();

  expect(intro()).toBeNull();
  expect(consent()).not.toBeNull();
});

it('上次停在第 3 步的老用户：不重播开场，只补条款', { timeout: 15000 }, async () => {
  localStorage.setItem('dela.onboarding.step', '2');
  stubDela(false);
  const { onConsentDone } = await renderFlow();

  expect(intro()).toBeNull();
  expect(consent()).not.toBeNull();
  await act(async () => button('同意并继续').click());
  await act(async () => button('同意并继续').click());
  expect(onConsentDone).toHaveBeenCalledTimes(1);
});
