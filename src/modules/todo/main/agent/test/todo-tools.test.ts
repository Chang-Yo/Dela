import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem, TodoState } from '../../../contract';
import { todoDomain } from '../index';

vi.mock('../../store', () => ({
  getTodoState: vi.fn(),
  refreshTodos: vi.fn(),
  saveTodo: vi.fn(),
  removeTodo: vi.fn(),
}));

import { getTodoState, refreshTodos, removeTodo, saveTodo } from '../../store';

const state = vi.mocked(getTodoState);
const refresh = vi.mocked(refreshTodos);
const save = vi.mocked(saveTodo);
const remove = vi.mocked(removeTodo);

function todoItem(overrides: Partial<TodoItem>): TodoItem {
  return {
    id: '0d7d21f5-8d5a-4f97-9c7f-2f5dfc1a1b2a',
    source: 'personal',
    title: '写周报',
    notes: '',
    time: null,
    status: 'open',
    completedAt: null,
    readAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const source = {
  id: 'canvas',
  label: 'Canvas 作业',
  connected: true,
  syncedAt: '2026-09-28T00:00:00.000Z',
  error: null,
};

function todoState(overrides: Partial<TodoState> = {}): TodoState {
  return {
    items: [
      todoItem({}),
      todoItem({
        id: 'canvas:owner:1:2',
        source: 'canvas',
        title: '作业一',
        group: { id: '1', label: '操作系统' },
        time: { kind: 'due', at: '2026-10-01T16:00:00.000Z' },
        status: 'done',
        statusLabel: '已提交',
        bodyHtml: '<p>作业描述 HTML</p>',
      }),
      todoItem({ id: 'canvas:owner:1:3', source: 'canvas', title: '线下作业', status: 'unknown' }),
    ],
    sources: [source],
    syncing: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.mockReturnValue(todoState());
});

describe('query_todos', () => {
  it('returns the unified list without source HTML bodies', () => {
    const result = todoDomain.commands.query_todos.execute({}) as {
      items: { id: string; bodyHtml?: unknown }[];
      total: number;
      freshness: unknown;
      coverage: unknown;
    };
    expect(result.total).toBe(3);
    expect(result.items.every((item) => item.bodyHtml === undefined)).toBe(true);
    expect(result.freshness).toEqual({ kind: 'cached', syncedAt: '2026-09-28T00:00:00.000Z' });
    expect(result.coverage).toEqual({ scope: 'todos_and_cached_sources', complete: true });
  });

  it('filters by keyword, group and completion; unknown counts as neither', () => {
    const byGroup = todoDomain.commands.query_todos.execute({ query: '操作系统' }) as {
      total: number;
    };
    expect(byGroup.total).toBe(1);
    const done = todoDomain.commands.query_todos.execute({ query: '', completed: true }) as {
      total: number;
    };
    expect(done.total).toBe(1);
    const open = todoDomain.commands.query_todos.execute({ query: '', completed: false }) as {
      total: number;
    };
    expect(open.total).toBe(1);
    const ranged = todoDomain.commands.query_todos.execute({
      startAt: '2026-10-01T00:00:00.000Z',
      endAt: '2026-10-02T00:00:00.000Z',
    }) as { items: { id: string }[] };
    expect(ranged.items.map((item) => item.id)).toEqual(['canvas:owner:1:2']);
  });

  it('warns about sources that are not connected', () => {
    state.mockReturnValue(
      todoState({ sources: [{ ...source, connected: false, syncedAt: null }] }),
    );
    const result = todoDomain.commands.query_todos.execute({}) as {
      coverage: { complete: boolean; warnings: string[] };
    };
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.warnings[0]).toContain('Canvas 作业未连接');
  });
});

describe('save_todo', () => {
  it('maps a missing target id to NOT_FOUND', () => {
    save.mockImplementation(() => {
      throw new Error('待办不存在，外部来源的条目只能通过同步更新');
    });
    let caught: unknown;
    try {
      todoDomain.commands.save_todo.execute({
        id: '00000000-0000-4000-8000-000000000000',
        title: 'x',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('remove_todo', () => {
  it('refuses source items and unknown ids', () => {
    let caught: unknown;
    try {
      todoDomain.commands.remove_todo.execute({ id: 'canvas:owner:1:2' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'OPERATION_FAILED' });
    expect(remove).not.toHaveBeenCalled();

    caught = undefined;
    try {
      todoDomain.commands.remove_todo.execute({ id: 'nope' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'NOT_FOUND' });
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('refresh_todos', () => {
  it('reports NOT_CONFIGURED when no source is connected', async () => {
    state.mockReturnValue(todoState({ sources: [{ ...source, connected: false }] }));
    await expect(todoDomain.commands.refresh_todos.execute({})).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
