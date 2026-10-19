// @vitest-environment jsdom
// 字号设置：整数像素、± 逐像素步进、边界禁用与输入框失焦收敛。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSection } from './AppearanceSection';

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
  delete window.dela;
  vi.unstubAllGlobals();
});

function render(fontSize: number) {
  const onFontSizeChange = vi.fn(async () => {});
  act(() =>
    root.render(
      <AppearanceSection
        fontSize={fontSize}
        onFontSizeChange={onFontSizeChange}
        onThemeChange={async () => {}}
        onZoomChange={async () => {}}
        theme="light"
        zoom={1}
      />,
    ),
  );
  return onFontSizeChange;
}

const control = (selector: string) => {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
};
const fontSizeInput = () => control('input[aria-label="字号"]') as HTMLInputElement;

describe('font size', () => {
  it('shows the current size and steps one pixel at a time', async () => {
    const onFontSizeChange = render(16);
    const input = fontSizeInput();
    expect(input.value).toBe('16');

    // 箭头是按住连发的 pointerdown 交互，首次按下即走一步。
    const press = async (selector: string) => {
      const button = control(selector);
      await act(async () => {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      });
    };
    await press('button[aria-label="增加字号"]');
    expect(onFontSizeChange).toHaveBeenCalledWith(17);
    await press('button[aria-label="减少字号"]');
    expect(onFontSizeChange).toHaveBeenCalledWith(15);
  });

  it('disables the arrow at each boundary', () => {
    render(12);
    expect(control('button[aria-label="减少字号"]').hasAttribute('disabled')).toBe(true);
    expect(control('button[aria-label="增加字号"]').hasAttribute('disabled')).toBe(false);
    act(() => root.unmount());
    root = createRoot(container);
    render(20);
    expect(control('button[aria-label="增加字号"]').hasAttribute('disabled')).toBe(true);
    expect(control('button[aria-label="减少字号"]').hasAttribute('disabled')).toBe(false);
  });

  it('clamps a typed value on blur and abandons an empty edit', async () => {
    const onFontSizeChange = render(16);
    const input = fontSizeInput();
    const type = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    };

    await type('99');
    expect(onFontSizeChange).toHaveBeenCalledWith(20);
    await type('');
    expect(onFontSizeChange).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('16');
  });
});
