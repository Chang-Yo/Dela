// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DatePicker } from './date-picker';
import { TimePicker } from './time-picker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  await act(async () => host.querySelector('button')!.click());
  return async () => {
    await act(async () => root.unmount());
    host.remove();
  };
}

it('日期选择器换日期时保留原来的时分', async () => {
  const onValueChange = vi.fn();
  const cleanup = await render(
    <DatePicker onValueChange={onValueChange} value={new Date(2026, 10, 21, 23, 59)} />,
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="2026年11月25日"]')!.click(),
  );
  expect(onValueChange).toHaveBeenCalledWith(new Date(2026, 10, 25, 23, 59));
  await cleanup();
});

it('时间选择器接受直接输入，不合法的输入保持原值', async () => {
  const onValueChange = vi.fn();
  const cleanup = await render(
    <TimePicker onValueChange={onValueChange} value={new Date(2026, 10, 21, 23, 59)} />,
  );
  const input = document.querySelector<HTMLInputElement>('input[aria-label="输入时间"]')!;
  const type = async (text: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
  };
  await type('2575');
  expect(onValueChange).not.toHaveBeenCalled();
  await type('0930');
  expect(onValueChange).toHaveBeenCalledWith(new Date(2026, 10, 21, 9, 30));
  await cleanup();
});
