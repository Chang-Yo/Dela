// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, GlobalSearchResult } from '../../../shared/api';
import { GlobalSearchDialog } from './GlobalSearchDialog';

const results: GlobalSearchResult[] = [
  {
    kind: 'todo',
    id: 'todo',
    title: '邮件待办',
    subtitle: null,
    target: { page: 'todo', todoId: 'todo' },
  },
  {
    kind: 'project',
    id: 'project',
    title: '邮件项目',
    subtitle: null,
    target: { page: 'projects', entryId: 'project' },
  },
  {
    kind: 'mail',
    id: 1,
    title: '邮件通知',
    subtitle: null,
    target: { page: 'mail', messageId: 1 },
  },
];
const onSelect = vi.fn();
const onOpenChange = vi.fn();
const scrollIntoView = Element.prototype.scrollIntoView;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  window.dela = {
    search: { query: vi.fn(async () => results) },
  } as unknown as DelaApi;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.dela;
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openSearch() {
  await act(async () => {
    root.render(<GlobalSearchDialog open onSelect={onSelect} onOpenChange={onOpenChange} />);
  });
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '邮件');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(window.dela!.search.query).toHaveBeenCalledWith('邮件');
  return {
    input,
    options: [...document.querySelectorAll<HTMLElement>('[role="option"]')],
  };
}

async function press(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await vi.advanceTimersByTimeAsync(20);
  });
}

it('默认选中可见的第一项，方向键按显示顺序跨组移动并首尾循环', async () => {
  const { input, options } = await openSearch();
  expect(options).toHaveLength(4);
  const first = options[0]!;
  const expectSelected = (option: HTMLElement) => {
    expect(document.querySelector('[role="option"][aria-selected="true"]')).toBe(option);
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
  };
  expectSelected(first);
  for (const option of [...options.slice(1), first]) {
    await press(input, 'ArrowDown');
    expectSelected(option);
  }
  for (const option of options.toReversed()) {
    await press(input, 'ArrowUp');
    expectSelected(option);
  }
  await press(input, 'Enter');
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(results[1]);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('鼠标定位后按向下键选中紧邻的下一项，回车打开该项', async () => {
  const { input, options } = await openSearch();
  const mail = options[1]!;
  const todo = options[2]!;
  await act(async () => {
    mail.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });
  expect(mail.getAttribute('aria-selected')).toBe('true');
  await press(input, 'ArrowDown');
  expect(todo.getAttribute('aria-selected')).toBe('true');
  expect(input.getAttribute('aria-activedescendant')).toBe(todo.id);
  expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(todo);
  await press(input, 'Enter');
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(results[0]);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
