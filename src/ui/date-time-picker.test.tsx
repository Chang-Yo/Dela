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

it('时间选择器的列首尾相接，越过 23 点或 59 分不改日期', async () => {
  const onValueChange = vi.fn();
  const cleanup = await render(
    <TimePicker onValueChange={onValueChange} value={new Date(2026, 10, 21, 23, 59)} />,
  );
  const column = (label: string) =>
    document.querySelector<HTMLElement>(`[role="spinbutton"][aria-label="${label}"]`)!;
  await act(async () =>
    column('小时').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  );
  expect(onValueChange).toHaveBeenLastCalledWith(new Date(2026, 10, 21, 0, 59));
  await act(async () =>
    column('分钟').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true })),
  );
  expect(onValueChange).toHaveBeenLastCalledWith(new Date(2026, 10, 21, 23, 0));
  await cleanup();
});
