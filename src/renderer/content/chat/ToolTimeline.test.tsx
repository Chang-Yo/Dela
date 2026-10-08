// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReplyTrace } from './ToolTimeline';
import type { AgentToolResult, WorkspaceChat } from '../../../shared/api';

vi.mock('./markdown', () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => children,
}));

type Parts = NonNullable<WorkspaceChat['messages'][number]['parts']>;
let host: HTMLDivElement;
let root: Root;

const read = (id: string, path: string, done = true): AgentToolResult => ({
  id,
  name: 'read',
  input: { path },
  ...(done ? { output: { text: 'ok' }, finishedAt: 1 } : {}),
});

const render = (parts: Parts, live = false) =>
  act(async () => root.render(<ReplyTrace live={live} parts={parts} />));
const rows = () => [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('运行中逐行展示步骤：当前步骤用进行时，对象只显示文件名', async () => {
  await render([{ type: 'tools', results: [read('a', 'D:/p/notes.md', false)] }], true);
  expect(rows()[0]?.textContent).toContain('正在读取');
  expect(rows()[0]?.textContent).toContain('notes.md');
  expect(rows()[0]?.textContent).not.toContain('D:/p');
});

it('完成后连续工具收成摘要行，展开看到每一步', async () => {
  await render([
    { type: 'text', text: '我先看看' },
    { type: 'tools', results: [read('a', 'a.md'), read('b', 'b.md')] },
    {
      type: 'tools',
      results: [
        {
          id: 'c',
          name: 'edit',
          input: { path: 'a.md', edits: [{ oldText: 'x', newText: 'y\nz' }] },
          output: { text: '' },
          finishedAt: 2,
        },
      ],
    },
    { type: 'text', text: '改好了' },
  ]);
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.textContent).toBe('读取 2 个文件，编辑 1 个文件');
  // 不出现操作数、失败数这类统计。
  expect(host.textContent).not.toMatch(/项操作|项失败/);
  await act(async () => rows()[0]!.click());
  expect(rows().map((row) => row.textContent)).toContain('编辑a.md+2 −1');
});

it('失败只在步骤行尾标注，原因在展开后可见', async () => {
  await render([
    {
      type: 'tools',
      results: [
        {
          id: 'e',
          name: 'edit',
          input: { path: 'a.md' },
          output: { text: 'oldText 不存在', isError: true },
          finishedAt: 1,
        },
      ],
    },
  ]);
  expect(rows()[0]!.textContent).toContain('失败');
  expect(host.textContent).not.toContain('oldText 不存在');
  await act(async () => rows()[0]!.click());
  expect(host.textContent).toContain('oldText 不存在');
});

it('正文与过程按顺序交错，流式增长不重建正文节点', async () => {
  const trace: Parts = [
    { type: 'text', text: '先查看' },
    { type: 'tools', results: [read('a', 'a.md')] },
    { type: 'text', text: '找到了' },
  ];
  await render(trace, true);
  const bodies = [...host.querySelectorAll('[data-assistant-body]')];
  expect(bodies.map((node) => node.textContent)).toEqual(['先查看', '找到了']);
  await render([...trace.slice(0, 2), { type: 'text', text: '找到了，继续' }], true);
  expect([...host.querySelectorAll('[data-assistant-body]')]).toEqual(bodies);
});

it('思考默认收起，进行中显示正在思考', async () => {
  await render([{ type: 'reasoning', text: '核对资料' }], true);
  expect(rows()[0]!.textContent).toBe('正在思考');
  expect(host.querySelector('[data-reasoning-body]')).toBeNull();
  await act(async () => rows()[0]!.click());
  expect(host.querySelector('[data-reasoning-body]')?.textContent).toBe('核对资料');
});

it('结束时未完成的步骤标注未完成', async () => {
  await render([{ type: 'tools', results: [read('a', 'a.md', false)] }], false);
  expect(rows()[0]!.textContent).toContain('未完成');
});
