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

const render = (
  parts: Parts,
  live = false,
  times: { startedAt?: number; finishedAt?: number } = {},
) => act(async () => root.render(<ReplyTrace live={live} parts={parts} {...times} />));
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

it('运行中逐行展示步骤：对象只显示文件名', async () => {
  await render([{ type: 'tools', results: [read('a', 'D:/p/notes.md', false)] }], true);
  expect(rows()[0]?.textContent).toContain('notes.md');
  expect(rows()[0]?.textContent).not.toContain('D:/p');
});

it('完成后连续工具收成摘要行，展开看到每一步', async () => {
  await render(
    [
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
    ],
    false,
    { startedAt: 1_000, finishedAt: 134_000 },
  );
  // 结束后过程整体折叠：只剩一行用时和最终回复。
  const visible = () => rows().filter((row) => !row.closest('[hidden]'));
  expect(visible()).toHaveLength(1);
  expect(host.querySelector('[data-assistant-body]')!.closest('[hidden]')).not.toBeNull();
  expect([...host.querySelectorAll('[data-assistant-body]')].at(-1)!.textContent).toBe('改好了');
  await act(async () => visible()[0]!.click());
  expect(visible()).toHaveLength(2);
  await act(async () => visible()[1]!.click());
  const editRow = visible().at(-1)!;
  expect(editRow.textContent).toContain('a.md');
  expect(editRow.textContent).toContain('+2');
  expect(editRow.textContent).toContain('−1');
});

it('失败原因默认折叠，展开后可见', async () => {
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
  expect(host.textContent).not.toContain('oldText 不存在');
  await act(async () => rows()[0]!.click());
  expect(host.textContent).toContain('oldText 不存在');
});

it('失败的 bash 也在代码块里显示命令与输出', async () => {
  await render([
    {
      type: 'tools',
      results: [
        {
          id: 'b',
          name: 'bash',
          input: { command: 'systemctl status dela' },
          output: { text: 'Unit dela.service could not be found.', isError: true },
          finishedAt: 1,
        },
      ],
    },
  ]);
  await act(async () => rows()[0]!.click());
  const block = [...host.querySelectorAll('code')].map((node) => node.textContent).join('\n');
  expect(block).toContain('$ systemctl status dela');
  expect(block).toContain('Unit dela.service could not be found.');
});

it('运行中不折叠；结束后折叠过程，最终正文节点不重建', async () => {
  const trace: Parts = [
    { type: 'reasoning', text: '想一想' },
    { type: 'tools', results: [read('a', 'a.md')] },
    { type: 'text', text: '结论' },
  ];
  await render(trace, true);
  expect(host.querySelector('[hidden]')).toBeNull();
  const answer = host.querySelector('[data-assistant-body]')!;
  await render(trace, false);
  expect(host.querySelector('[data-assistant-body]')).toBe(answer);
  expect(answer.closest('[hidden]')).toBeNull();
  expect(host.querySelectorAll('[hidden]')).toHaveLength(2);
});

it('只有正文、或以工具收尾时不折叠', async () => {
  await render([{ type: 'text', text: '直接回答' }]);
  expect(rows()).toHaveLength(0);
  await render([
    { type: 'text', text: '我去改' },
    { type: 'tools', results: [read('a', 'a.md')] },
  ]);
  expect(host.querySelector('[hidden]')).toBeNull();
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

it('思考默认收起，展开后看到内容', async () => {
  await render([{ type: 'reasoning', text: '核对资料' }], true);
  expect(host.querySelector('[data-reasoning-body]')).toBeNull();
  await act(async () => rows()[0]!.click());
  expect(host.querySelector('[data-reasoning-body]')?.textContent).toBe('核对资料');
});
it('读取图片的步骤展开后预览图片本体，不显示占位文本', async () => {
  await render([
    {
      type: 'tools',
      results: [
        {
          id: 'img',
          name: 'read',
          input: { path: 'D:/p/05.jpg' },
          output: {
            text: 'Read image file [image/jpeg]',
            image: { mimeType: 'image/jpeg', data: 'aGVsbG8=' },
          },
          finishedAt: 1,
        },
      ],
    },
  ]);
  await act(async () => rows()[0]!.click());
  const image = host.querySelector('img');
  expect(image?.getAttribute('src')).toBe('data:image/jpeg;base64,aGVsbG8=');
  expect(image?.getAttribute('alt')).toBe('D:/p/05.jpg');
  expect(host.textContent).not.toContain('Read image file');
  // 点击预览图打开全屏看图，Esc 关闭。
  await act(async () => image!.click());
  const dialog = document.body.querySelector('[role="dialog"][aria-label="图片查看"]');
  expect(dialog).not.toBeNull();
  expect(dialog!.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,aGVsbG8=');
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(document.body.querySelector('[role="dialog"][aria-label="图片查看"]')).toBeNull();
});
