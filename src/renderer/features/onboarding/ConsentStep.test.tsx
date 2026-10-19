// @vitest-environment jsdom
// 条款接受页：两份条款依次展示，各自读到最底部才能点「同意并继续」，
// 第一份同意只是翻到第二份，两份都同意后才回调放行；这一页没有跳过。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import privacy from '../../../../docs/privacy.md?raw';
import terms from '../../../../docs/terms.md?raw';
import { ConsentStep } from './ConsentStep';

let container: HTMLDivElement;
let root: Root;
let observer: { observed: Element[]; disconnects: number };
// jsdom 不做布局，滚动尺寸恒为 0，等于「内容放得下、全都看得见」。这里给正文框装上可控的
// 「内容高 / 视口高」，否则「必须滑到底」这条规则根本无从验证：按 0 高度算，谁都是读完的。
let metrics: { content: number; viewport: number };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  observer = { observed: [], disconnects: 0 };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(target: Element) {
        observer.observed.push(target);
      }
      disconnect() {
        observer.disconnects += 1;
      }
    },
  );
  metrics = { content: 1000, viewport: 400 };
  for (const [name, pick] of [
    ['scrollHeight', () => metrics.content],
    ['clientHeight', () => metrics.viewport],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-consent-text') ? pick() : 0;
      },
    });
  }
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  vi.unstubAllGlobals();
  localStorage.clear();
});

function box() {
  return container.querySelector<HTMLElement>('[data-consent-text]')!;
}

/** 按 scrollTop 触发一次滚动；内容高与视口高来自本用例的 metrics。 */
async function scrollTo(scrollTop: number) {
  box().scrollTop = scrollTop;
  await act(async () => box().dispatchEvent(new Event('scroll')));
}

function title() {
  return container.querySelector('header h1')?.textContent;
}

function button(text: string) {
  const element = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`找不到按钮：${text}`);
  return element;
}

function hasButton(text: string) {
  return [...container.querySelectorAll('button')].some((item) => item.textContent?.includes(text));
}

async function render(onAgree: () => void, canBackup = false) {
  await act(async () => root.render(<ConsentStep canBackup={canBackup} onAgree={onAgree} />));
}

/** 只取正文里跨行不成问题的一段，避免把测试钉死在某一句话的措辞上。 */
function firstHeading(markdown: string) {
  return /^## (.+)$/m.exec(markdown)?.[1] ?? '';
}

/** 滚动框与「同意并继续」的关系。 */
async function agreeOnce() {
  await scrollTo(600);
  await act(async () => button('同意并继续').click());
}

it('先展示使用条款，内容不溢出时按钮直接可用', async () => {
  // 内容放得下就是全都看得见，不需要先滚一下。
  metrics = { content: 400, viewport: 400 };
  const onAgree = vi.fn();
  await render(onAgree);

  expect(title()).toBe('使用条款');
  expect(box().textContent).toContain(firstHeading(terms));
  expect(box().textContent).not.toContain(firstHeading(privacy));
  // 这一页只有「不同意并退出」与「同意并继续」，没有跳过。
  expect(hasButton('不同意并退出')).toBe(true);
  expect(hasButton('同意并继续')).toBe(true);
  expect(hasButton('跳过')).toBe(false);
  expect(button('同意并继续').disabled).toBe(false);
});

it('还没滑到底时不能同意，滑到底才解锁', async () => {
  const onAgree = vi.fn();
  await render(onAgree);

  await scrollTo(200);
  expect(button('同意并继续').disabled).toBe(true);
  await act(async () => button('同意并继续').click());
  expect(onAgree).not.toHaveBeenCalled();
  expect(title()).toBe('使用条款');

  await scrollTo(600);
  expect(button('同意并继续').disabled).toBe(false);
});

it('读到底之后文本框变矮也不会重新锁住', async () => {
  // 导出提示出现、窗口变矮都会只改变文本框高度，让人从「到底」变成「差一截」。
  // 正文没变，读过的就是读过了，否则刚点完导出还得再滚一下才能同意。
  const onAgree = vi.fn();
  await render(onAgree);

  await scrollTo(600);
  expect(button('同意并继续').disabled).toBe(false);

  metrics = { content: 1000, viewport: 300 };
  await act(async () => box().dispatchEvent(new Event('scroll')));
  expect(button('同意并继续').disabled).toBe(false);
});

it('两份条款都要各自滑到底并同意，第二次同意才放行', async () => {
  const onAgree = vi.fn();
  await render(onAgree);

  await agreeOnce();
  // 翻到第二份后回到顶部重新计，第一份的阅读进度不带过来。
  expect(title()).toBe('隐私条款');
  expect(box().textContent).toContain(firstHeading(privacy));
  expect(box().scrollTop).toBe(0);
  expect(button('同意并继续').disabled).toBe(true);
  expect(onAgree).not.toHaveBeenCalled();
  // 换条款时按钮会变回禁用，焦点必须交给正文，键盘与读屏用户才不丢位置。
  expect(document.activeElement).toBe(box());

  await act(async () => button('同意并继续').click());
  expect(onAgree).not.toHaveBeenCalled();

  await agreeOnce();
  expect(onAgree).toHaveBeenCalledTimes(1);
});

it('接受每一份时都留下带版本的记录', async () => {
  const record = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('dela', { consent: { record } });
  await render(vi.fn());

  // 两份条款各自的「最后更新」日期随记录一起落库，日后回溯得到同意的是哪一版。
  await agreeOnce();
  expect(record).toHaveBeenNthCalledWith(1, 'terms', '2026-10-15');
  await agreeOnce();
  expect(record).toHaveBeenNthCalledWith(2, 'privacy', '2026-10-15');
});

it('文本框与正文都在观察范围内，卸载时断开', async () => {
  await render(vi.fn());

  const content = box().firstElementChild;
  expect(observer.observed).toContain(box());
  expect(observer.observed).toContain(content);
  // 观察目标不随滚动事件增减。
  expect(observer.observed).toHaveLength(2);

  await act(async () => root.unmount());
  expect(observer.disconnects).toBe(1);
});

it('不同意并退出走真正退出应用的通道，不触发同意', async () => {
  const quit = vi.fn();
  const close = vi.fn();
  vi.stubGlobal('dela', { window: { close, quit } });
  const onAgree = vi.fn();
  await render(onAgree);

  await act(async () => button('不同意并退出').click());
  expect(quit).toHaveBeenCalledTimes(1);
  // close() 只把窗口收进托盘，进程还在跑，不能用来兑现「退出」。
  expect(close).not.toHaveBeenCalled();
  expect(onAgree).not.toHaveBeenCalled();
});

it('只有已经有本机数据的安装才显示导出入口与导出提示', async () => {
  vi.stubGlobal('dela', {});
  await render(vi.fn(), false);
  expect(hasButton('导出本机数据')).toBe(false);
  // 没有导出入口就不该有导出提示。
  expect(container.querySelector('[role="status"]')).toBeNull();

  await render(vi.fn(), true);
  expect(hasButton('导出本机数据')).toBe(true);
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});

it('导出成功后显示保存位置', async () => {
  const exportData = vi.fn().mockResolvedValue({
    status: 'exported',
    path: 'D:\\备份\\Dela 备份 2026-10-15 17-30',
    skipped: [],
  });
  vi.stubGlobal('dela', { backup: { exportData } });
  await render(vi.fn(), true);

  await act(async () => button('导出本机数据').click());
  expect(exportData).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('D:\\备份\\Dela 备份 2026-10-15 17-30');
});

it('导出期间两个按钮都锁住，连点不会重复导出', async () => {
  let finish: (value: unknown) => void = () => {};
  const exportData = vi.fn(() => new Promise((resolve) => (finish = resolve)));
  vi.stubGlobal('dela', { backup: { exportData } });
  await render(vi.fn(), true);

  await act(async () => button('导出本机数据').click());
  expect(button('导出本机数据').disabled).toBe(true);
  // 导出到一半退出会留下半个文件夹，用户还不知道少了什么。
  expect(button('不同意并退出').disabled).toBe(true);
  await act(async () => button('导出本机数据').click());
  expect(exportData).toHaveBeenCalledTimes(1);

  await act(async () => finish({ status: 'cancelled' }));
  expect(button('导出本机数据').disabled).toBe(false);
  expect(button('不同意并退出').disabled).toBe(false);
});

it('用户取消导出后回到可导出状态；漏拷的条目如实列出', async () => {
  const exportData = vi.fn().mockResolvedValue({ status: 'cancelled' });
  vi.stubGlobal('dela', { backup: { exportData } });
  await render(vi.fn(), true);

  await act(async () => button('导出本机数据').click());
  expect(button('导出本机数据').disabled).toBe(false);

  exportData.mockResolvedValue({
    status: 'exported',
    path: 'D:\\备份',
    skipped: ['Local Storage', '工作目录'],
  });
  await act(async () => button('导出本机数据').click());
  expect(container.textContent).toContain('Local Storage、工作目录');
});

it('保存位置不能用时说清原因，不让人反复重试', async () => {
  const exportData = vi.fn().mockResolvedValue({
    status: 'failed',
    reason: '不能保存到 Dela 的数据目录里，请另选一个位置',
  });
  vi.stubGlobal('dela', { backup: { exportData } });
  await render(vi.fn(), true);

  await act(async () => button('导出本机数据').click());
  expect(container.textContent).toContain('不能保存到 Dela 的数据目录里，请另选一个位置');
  expect(button('导出本机数据').disabled).toBe(false);
});

it('导出抛错后按钮不会卡死', async () => {
  const exportData = vi.fn().mockRejectedValue(new Error('磁盘已满'));
  vi.stubGlobal('dela', { backup: { exportData } });
  await render(vi.fn(), true);

  await act(async () => button('导出本机数据').click());
  expect(button('导出本机数据').disabled).toBe(false);
});
