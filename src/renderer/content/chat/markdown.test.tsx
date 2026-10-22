// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatMarkdown } from './markdown';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('static 模式保留未闭合尖括号之后的正文', async () => {
  await act(async () => {
    root.render(<ChatMarkdown>{'n<m 后面的内容'}</ChatMarkdown>);
  });

  expect(host.textContent).toContain('后面的内容');
});
