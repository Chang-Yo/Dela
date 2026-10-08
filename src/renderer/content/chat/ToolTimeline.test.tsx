// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkingSection } from './ToolTimeline';
import type { WorkspaceChat } from '../../../shared/api';

vi.mock('./markdown', () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => children,
}));

let host: HTMLDivElement;
let root: Root;
const parts: NonNullable<WorkspaceChat['messages'][number]['parts']> = [
  { type: 'reasoning' as const, text: '先核对资料' },
  { type: 'text' as const, text: '查询本周作业' },
  { type: 'text' as const, text: '我' },
  { type: 'text' as const, text: '我来' },
  {
    type: 'tools' as const,
    results: [{ id: 'tool-1', name: 'grep', input: { pattern: '高等数学' } }],
  },
];
const render = async (live = true, failed = 0, trace = parts) => {
  await act(async () =>
    root.render(
      <WorkingSection
        parts={trace}
        live={live}
        elapsedMs={live ? null : 5200}
        failed={failed}
        status="done"
      />,
    ),
  );
};
const trigger = () => host.querySelector<HTMLButtonElement>('button')!;
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

it('新一轮运行自动展开，入口显示当前动作及其对象', async () => {
  await render();
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(trigger().textContent).toContain('正在搜索内容');
  expect(trigger().textContent).toContain('高等数学');
  expect(host.querySelector('[aria-label="工作过程"]')).not.toBeNull();
});

it('正文流式输出不提前收起，整轮完成才自动折叠且允许重新展开', async () => {
  await render();
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).toContain('先核对资料');
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).not.toContain('查询本周作业');
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).not.toContain('我来');
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).not.toContain('进度说明');
  expect(trigger().textContent).toContain('正在搜索内容');
  await act(async () =>
    root.render(<WorkingSection parts={parts} live elapsedMs={null} failed={0} status="done" />),
  );
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  await render(false);
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(trigger().textContent).toContain('已完成');
  expect(trigger().textContent).toContain('5 秒');
  await act(async () => trigger().click());
  expect(host.querySelector('[aria-label="工作过程"]')).not.toBeNull();
});

it('运行中手动收起后不被流式更新打开，下一轮重新自动展开', async () => {
  await render();
  await act(async () => trigger().click());
  await render();
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  await render(false);
  await render();
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
});

it('折叠态保留失败计数，展开后显示完整错误并将原始数据置于明确的详情入口', async () => {
  const failedParts = [
    {
      type: 'tools' as const,
      results: [
        {
          id: 'tool-1',
          name: 'mcp_docs_search',
          input: { query: '高等数学' },
          output: { text: '资料尚未同步', isError: true },
          finishedAt: 1,
        },
      ],
    },
  ];
  await act(async () =>
    root.render(
      <WorkingSection parts={failedParts} live={false} elapsedMs={1000} failed={1} status="done" />,
    ),
  );
  expect(trigger().textContent).toContain('1 项失败');
  await act(async () => trigger().click());
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).toContain('资料尚未同步');
  expect(host.querySelector('summary')?.textContent).toContain('mcp_docs_search');
  expect(host.textContent).not.toContain('输入与结果');
  expect(host.querySelector('details')?.open).toBe(false);
  await act(async () => host.querySelector('summary')!.click());
  expect(host.querySelector('details')?.open).toBe(true);
  // 兜底视图以"键: 值"展示输入，不再渲染原始 JSON 信封。
  expect(host.querySelector('details')?.textContent).toContain('query: 高等数学');
  await act(async () => host.querySelector('summary')!.click());
  expect(host.querySelector('details')?.open).toBe(false);
});

it.each(['stopped', 'interrupted'] as const)(
  '结束为 %s 时保留实际状态，未完成工具不伪装成功',
  async (status) => {
    await act(async () =>
      root.render(
        <WorkingSection parts={parts} live={false} elapsedMs={null} failed={0} status={status} />,
      ),
    );
    expect(trigger().textContent).toContain(status === 'stopped' ? '已停止' : '工作中断');
    await act(async () => trigger().click());
    expect(
      [...host.querySelectorAll('[aria-label="工作过程"]')]
        .map((group) => group.textContent)
        .join(''),
    ).toContain('未完成');
  },
);

it('完成的思考收成一行弱化文案，点击可展开全文', async () => {
  const timed: typeof parts = [
    { type: 'reasoning' as const, text: '先核对资料', startedAt: 0, finishedAt: 3000 },
  ];
  await act(async () =>
    root.render(
      <WorkingSection parts={timed} live={false} elapsedMs={3000} failed={0} status="done" />,
    ),
  );
  await act(async () => trigger().click());
  expect(host.querySelector('[aria-label="工作过程"]')?.textContent).toContain('3 秒');
  // 收起态：思考正文视觉隐藏（高度 0 + aria-hidden），仅剩一行摘要。
  expect(host.querySelector('[aria-hidden="true"] [data-reasoning-body]')).not.toBeNull();
  const thoughtToggle = () => host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')[1]!;
  await act(async () => thoughtToggle().click());
  expect(host.querySelector('[aria-hidden="true"] [data-reasoning-body]')).toBeNull();
});

it('按原始事件顺序交错正文与过程，仅合并相邻过程，折叠不移动正文节点', async () => {
  const trace: NonNullable<WorkspaceChat['messages'][number]['parts']> = [
    { type: 'text', text: '先查看文件夹' },
    { type: 'reasoning', text: '核对文件夹身份' },
    {
      type: 'tools',
      results: [{ id: 'list', name: 'ls', input: {}, output: { text: '' }, finishedAt: 1 }],
    },
    { type: 'text', text: '找到垃圾邮件文件夹，继续搜索' },
    {
      type: 'tools',
      results: [{ id: 'search', name: 'grep', input: {}, output: { text: '' }, finishedAt: 1 }],
    },
    { type: 'text', text: '搜索结果如下' },
  ];
  await render(true, 0, trace);
  const rows = [...host.querySelector('[aria-label="对话过程"]')!.children];
  expect(rows).toHaveLength(5);
  expect(rows[0]?.textContent).toBe('先查看文件夹');
  expect(rows[1]?.textContent).toContain('核对文件夹身份');
  expect(rows[1]?.textContent).toContain('ls');
  expect(rows[2]?.textContent).toBe('找到垃圾邮件文件夹，继续搜索');
  expect(rows[3]?.textContent).toContain('grep');
  expect(rows[4]?.textContent).toBe('搜索结果如下');
  const textNodes = [...host.querySelectorAll('[data-assistant-body]')];
  await render(false, 0, trace);
  expect([...host.querySelectorAll('[data-assistant-body]')]).toEqual(textNodes);
  expect(host.querySelectorAll('[aria-label="工作过程"]')).toHaveLength(0);
  expect(host.textContent).toContain('先查看文件夹');
  expect(host.textContent).toContain('搜索结果如下');
  await act(async () => trigger().click());
  expect([...host.querySelectorAll('[data-assistant-body]')]).toEqual(textNodes);
  expect(host.querySelectorAll('[aria-label="工作过程"]')).toHaveLength(2);
});

it('运行中的思考默认展开，正文随流式直接可见', async () => {
  await act(async () =>
    root.render(
      <WorkingSection
        parts={[{ type: 'reasoning' as const, text: '先核对资料' }]}
        live
        elapsedMs={null}
        failed={0}
        status="done"
      />,
    ),
  );
  expect(host.querySelector('[aria-hidden="true"] [data-reasoning-body]')).toBeNull();
  expect(host.querySelector('[data-reasoning-body]')?.textContent).toContain('先核对资料');
});
