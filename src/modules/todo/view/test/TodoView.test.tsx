// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem, TodoSaveInput, TodoState } from '../../contract';
import { useTodoPreferences } from '../preferences';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好。
const api = vi.hoisted(() => {
  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {};
  window.dela = {
    bridge: {
      invoke: (channel: string, input: unknown) => handlers[channel.slice('todo:'.length)]!(input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  return handlers;
});
import { TodoView } from '../TodoView';

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
  {
    id: 'personal:3',
    source: 'personal',
    title: '有截止日期待办',
    notes: '',
    dueAt,
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
  localStorage.clear();
  useTodoPreferences.setState({ showCompleted: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  for (const name of ['state', 'markRead', 'refresh', 'save', 'remove'])
    api[name] = vi.fn(async () => state);
});

const view = () => (
  <QueryClientProvider client={new QueryClient()}>
    <TodoView />
  </QueryClientProvider>
);

async function renderView() {
  await act(async () => root.render(view()));
  await vi.waitFor(() => expect(host.textContent).not.toContain('正在加载'));
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('TODO 视图', () => {
  it('默认显示月历，未完成待办数量常驻筛选页签，可切换列表查看', async () => {
    await renderView();

    expect(host.querySelector('[aria-label="待办日历"]')).not.toBeNull();
    const findButton = (label: string) =>
      [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(label));
    expect(findButton('全部')!.textContent).toContain('3');
    expect(findButton('Canvas 作业')!.textContent).toContain('1');
    expect(findButton('个人待办')!.textContent).toContain('2');
    const listButton = findButton('列表')!;
    expect(listButton.textContent).not.toContain('1');
    expect(listButton.title).not.toContain('没有截止时间');

    await act(async () => {
      listButton.click();
    });

    expect(host.querySelector('[aria-label="待办日历"]')).toBeNull();
    expect(host.textContent).toContain('课程作业');
    expect(host.textContent).toContain('无截止日期待办');
    expect(findButton('全部')!.textContent).toContain('3');
  });

  it('显示已完成默认打开，关闭后重新挂载仍保持关闭', async () => {
    const completed: TodoItem = {
      id: 'personal:2',
      source: 'personal',
      title: '已完成的待办',
      notes: '',
      dueAt: null,
      status: 'completed',
      readAt: null,
      createdAt: dueAt,
    };
    api.state = vi.fn(async () => ({ ...state, items: [...items, completed] }));
    const findSwitch = () => host.querySelector<HTMLButtonElement>('[aria-label="显示已完成"]')!;

    await renderView();
    expect(findSwitch().getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('列表'))!
        .click();
    });
    expect(host.textContent).toContain('已完成的待办');

    await act(async () => {
      findSwitch().click();
    });
    expect(host.textContent).not.toContain('已完成的待办');
    expect(useTodoPreferences.getState().showCompleted).toBe(false);

    act(() => root.unmount());
    root = createRoot(host);
    await renderView();
    expect(findSwitch().getAttribute('aria-checked')).toBe('false');
    expect(host.textContent).not.toContain('已完成的待办');
  });

  it('新建待办保存时不会默认成已经过去的截止时间', async () => {
    const save = vi.fn(async (_input: unknown) => state);
    api.save = save;
    await renderView();
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('新建待办'))!
        .click();
    });

    const titleInput = host.querySelector<HTMLInputElement>(
      'input[placeholder="例如：准备小组展示"]',
    )!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(titleInput, '测试待办');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === '保存')!
        .click();
    });

    expect(save).toHaveBeenCalled();
    const saved = save.mock.calls[0]![0] as TodoSaveInput;
    expect(saved.dueAt == null || Date.parse(saved.dueAt) >= Date.now()).toBe(true);
  });
});
