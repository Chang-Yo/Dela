// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TodoSheet } from './TodoSheet';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

// 详情面板聚焦若不带 preventScroll，入场动画期间面板越出容器底边，
// 会把 overflow-hidden 祖先滚动 1.5rem 再钳回，背景随之抖动。
it('挂载聚焦面板时阻止祖先滚动（preventScroll）', () => {
  const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
  act(() => {
    root.render(
      <TodoSheet label="待办详情" title="作业一" onClose={() => {}}>
        <p>内容</p>
      </TodoSheet>,
    );
  });
  const section = host.querySelector('section[aria-label="待办详情"]');
  expect(section).toBeTruthy();
  const index = focusSpy.mock.instances.findIndex((instance) => instance === section);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(focusSpy.mock.calls[index]).toEqual([{ preventScroll: true }]);
});
