// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import privacy from '../../../../../docs/privacy.md?raw';
import terms from '../../../../../docs/terms.md?raw';

// 契约客户端在模块加载时取 bridge，须先于导入页面装好。
vi.hoisted(() => {
  window.dela = {
    bridge: { invoke: async () => undefined, subscribe: () => () => {} },
  } as unknown as NonNullable<typeof window.dela>;
});
import { ConsentStep } from '../ConsentStep';

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
  // jsdom 不做布局，滚动尺寸恒为 0，等于「内容放得下」；装上固定的内容高与视口高，
  // 「必须滑到底」才有得验证。
  for (const [name, value] of [
    ['scrollHeight', 1000],
    ['clientHeight', 400],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-consent-text') ? value : 0;
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

const box = () => container.querySelector<HTMLElement>('[data-consent-text]')!;
const title = () => container.querySelector('header h1')?.textContent;

function button(text: string) {
  const element = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`找不到按钮：${text}`);
  return element;
}

const firstHeading = (markdown: string) => /^## (.+)$/m.exec(markdown)?.[1] ?? '';

async function agreeOnce() {
  box().scrollTop = 600;
  await act(async () => box().dispatchEvent(new Event('scroll')));
  await act(async () => button('同意并继续').click());
}

it('两份条款都要各自滑到底并同意，第二次同意才放行', async () => {
  const onAgree = vi.fn();
  await act(async () => root.render(<ConsentStep canBackup={false} onAgree={onAgree} />));
  expect(title()).toBe('使用条款');
  expect(box().textContent).toContain(firstHeading(terms));
  expect(button('同意并继续').disabled).toBe(true);

  await agreeOnce();
  expect(title()).toBe('隐私条款');
  expect(box().textContent).toContain(firstHeading(privacy));
  expect(button('同意并继续').disabled).toBe(true);
  expect(onAgree).not.toHaveBeenCalled();

  await agreeOnce();
  expect(onAgree).toHaveBeenCalledTimes(1);
});
