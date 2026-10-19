// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiffView } from './DiffView';

let host: HTMLDivElement;
let root: Root;
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

it('四万行差异每次最多渲染 500 行，翻页后行号连续', async () => {
  const patch = '@@ -0,0 +1,40000 @@\n' + '+x\n'.repeat(40000);
  await act(async () => root.render(<DiffView patch={patch} />));
  expect(host.querySelectorAll('[role="row"]')).toHaveLength(500);
  const next = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '下一页',
  )!;
  await act(async () => next.click());
  expect(host.querySelectorAll('[role="row"]')).toHaveLength(500);
  expect(
    host.querySelectorAll('[role="row"]')[0]!.querySelectorAll('[role="rowheader"]')[1]!
      .textContent,
  ).toBe('500');

  await act(async () => root.render(<DiffView patch={'@@ -1,1 +1,1 @@\n-old\n+new\n'} />));
  expect(host.querySelectorAll('[role="row"]')).toHaveLength(3);
  expect(host.textContent).toContain('new');
  expect(host.querySelector('button')).toBeNull();
});

it('最后一页可查看剩余行，不能继续前翻或后翻越界', async () => {
  await act(async () =>
    root.render(<DiffView patch={'@@ -0,0 +1,600 @@\n' + '+x\n'.repeat(600)} />),
  );
  const [previous, next] = host.querySelectorAll('button');
  expect(previous!.disabled).toBe(true);
  await act(async () => next!.click());
  expect(host.querySelectorAll('[role="row"]')).toHaveLength(101);
  expect(next!.disabled).toBe(true);
  await act(async () => previous!.click());
  expect(previous!.disabled).toBe(true);
});
