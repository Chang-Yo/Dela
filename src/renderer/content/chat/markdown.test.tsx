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

  // 用户消息同样走 static，不能被 remend 当成未闭合标签截断。
  await act(async () => {
    root.render(<ChatMarkdown>{'a <b dsadas'}</ChatMarkdown>);
  });

  expect(host.textContent).toBe('a <b dsadas');
});

it('代码块用共用的 --syntax-* 配色高亮，不写死任何主题色值', async () => {
  await act(async () => {
    root.render(<ChatMarkdown>{'```js\nconst a = "s"; // c\n```'}</ChatMarkdown>);
  });
  await vi.waitFor(() => expect(host.querySelector('pre span[style]')).not.toBeNull(), {
    timeout: 10_000,
  });

  const styles = [...host.querySelectorAll<HTMLElement>('pre [style]')].map((node) =>
    node.getAttribute('style'),
  );
  expect(styles.join(';')).toContain('var(--syntax-keyword)');
  expect(styles.join(';')).toContain('var(--syntax-string)');
  expect(styles.join(';')).toContain('var(--syntax-comment)');
  expect(styles.join(';')).not.toMatch(/#[0-9a-f]{6}/i);
});
