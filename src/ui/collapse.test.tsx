// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Collapse } from './collapse';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (open: boolean) =>
  act(() =>
    root.render(
      <Collapse open={open}>
        <input required />
      </Collapse>,
    ),
  );

function endTransition() {
  const event = Object.assign(new Event('transitionend', { bubbles: true }), {
    propertyName: 'grid-template-rows',
  });
  act(() => host.querySelector('[data-slot="collapse"]')!.dispatchEvent(event));
}

it('收起动画结束后才卸载内容', () => {
  render(true);
  render(false);
  expect(host.querySelector('input')).not.toBeNull();
  endTransition();
  expect(host.querySelector('input')).toBeNull();
});

it('减少动态效果时收起立即卸载', () => {
  reducedMotion = true;
  render(true);
  render(false);
  expect(host.querySelector('input')).toBeNull();
});
