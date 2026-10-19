// @vitest-environment jsdom
// 导入模型弹层：默认勾上已导入的模型，搜索只过滤显示、不影响勾选，
// 确认时按检测列表顺序回传勾选结果，一个都没勾时不能导入。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StepModelImportDialog } from './step-model-import';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** 弹层经 Portal 挂到 body，不在 container 子树里。 */
function checkboxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`找不到按钮：${text}`);
  return element;
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function render(options: string[], preselected: string[]) {
  const onConfirm = vi.fn();
  await act(async () =>
    root.render(
      <StepModelImportDialog
        onConfirm={onConfirm}
        onOpenChange={() => {}}
        open
        options={options}
        preselected={preselected}
      />,
    ),
  );
  return onConfirm;
}

it('默认勾上已导入的模型，确认时按检测列表顺序回传', async () => {
  const onConfirm = await render(['b', 'a', 'c'], ['a', 'c']);
  expect(checkboxes().map((box) => box.checked)).toEqual([false, true, true]);

  await act(async () => button('导入所选 2 个').click());
  expect(onConfirm).toHaveBeenCalledWith(['a', 'c']);
});

it('搜索只过滤显示，勾选结果不受影响', async () => {
  const onConfirm = await render(['alpha', 'beta'], []);
  const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索模型 ID"]')!;
  await fill(search, 'beta');
  expect(checkboxes()).toHaveLength(1);

  await act(async () => checkboxes()[0]!.click());
  await act(async () => button('导入所选 1 个').click());
  // beta 在检测列表里排第二，但只有它被勾选。
  expect(onConfirm).toHaveBeenCalledWith(['beta']);
});

it('一个都没勾时导入按钮不可用', async () => {
  await render(['alpha'], []);
  expect(button('导入所选 0 个').disabled).toBe(true);
});
