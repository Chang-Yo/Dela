// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem, TodoState } from '../../../shared/api';
import { TodoView } from './TodoView';

const dueAt = new Date(2026, 9, 21, 23, 59).toISOString();
const items: TodoItem[] = [
  {
    id: 'canvas:1',
    source: 'canvas',
    title: '课程作业',
    notes: '',
    dueAt,
    status: 'pending',
    readAt: null,
    createdAt: dueAt,
    courseCode: 'CS101',
    courseName: '软件工程',
  },
  {
    id: 'personal:1',
    source: 'personal',
    title: '无截止日期待办',
    notes: '',
    dueAt: null,
    status: 'pending',
    readAt: null,
    createdAt: dueAt,
  },
];
const state: TodoState = {
  items,
  connected: false,
  syncing: false,
  syncedAt: null,
  error: null,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  window.dela = {
    todo: {
      getState: vi.fn(async () => state),
      onUpdate: vi.fn(() => () => {}),
      markRead: vi.fn(async () => state),
      refresh: vi.fn(async () => state),
      save: vi.fn(async () => state),
      remove: vi.fn(async () => state),
    },
  } as unknown as NonNullable<typeof window.dela>;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.dela;
  vi.restoreAllMocks();
});

describe('TODO 视图', () => {
  it('默认显示月历，无截止日期数量常驻筛选页签，可切换列表查看', async () => {
    await act(async () => {
      root.render(<TodoView />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.querySelector('[aria-label="待办日历"]')).not.toBeNull();
    const findButton = (label: string) =>
      [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(label));
    expect(findButton('全部')!.textContent).toContain('1');
    const listButton = findButton('列表')!;
    expect(listButton.textContent).not.toContain('1');
    expect(listButton.title).not.toContain('没有截止时间');

    await act(async () => {
      listButton.click();
    });

    expect(host.querySelector('[aria-label="待办日历"]')).toBeNull();
    expect(host.textContent).toContain('课程作业');
    expect(host.textContent).toContain('无截止日期待办');
    expect(findButton('全部')!.textContent).toContain('1');
  });
});
