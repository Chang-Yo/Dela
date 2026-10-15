// @vitest-environment jsdom
// 条款页：docs 下的 Markdown 到设置页版式的映射。两个文档各跑一遍。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import privacy from '../../../../../docs/privacy.md?raw';
import terms from '../../../../../docs/terms.md?raw';
import { PrivacySection } from './PrivacySection';
import { TermsSection } from './TermsSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/**
 * 加粗必须全部生效：源码里每对 ** 都要有一个 strong，正文里不能残留字面星号。
 * `。**你` 这类「加粗以中文标点收尾、紧跟汉字」的写法 CommonMark 不认为闭合，
 * 只会渲染出星号（GitHub 同样如此）——这条断言是回归护栏，改条款正文时别退化回去。
 */
function expectBoldAllRendered(markdown: string) {
  const strong = [...container.querySelectorAll('strong')].map((node) => node.textContent ?? '');
  expect(strong.length).toBe((markdown.match(/\*\*/g) ?? []).length / 2);
  expect(container.textContent).not.toContain('**');
  return strong;
}

async function render(node: ReactElement) {
  await act(async () => root.render(node));
}

it('使用条款：小节标题、加粗、接受声明与附录表格都按版式渲染', async () => {
  await render(<TermsSection />);

  // 页面标题只有 SectionHeader 那一个：Markdown 的 h1 与它重复，不渲染。
  expect([...container.querySelectorAll('h1')].map((node) => node.textContent)).toEqual([
    '使用条款',
  ]);

  const sections = [...container.querySelectorAll('h2')].map((node) => node.textContent);
  expect(sections[0]).toBe('1. 软件性质');
  expect(sections).toContain('12. 开源协议');

  const strong = expectBoldAllRendered(terms);
  expect(strong.some((text) => text.includes('不存在隶属、合作、赞助、认可或授权关系'))).toBe(true);

  expect(container.querySelector('blockquote')?.textContent).toContain(
    '以其他方式安装、运行本软件，同样视为你已阅读、理解并接受',
  );
  expect(container.querySelectorAll('tbody tr').length).toBe(13);
});

it('隐私条款：小节标题、加粗与两张表格都按版式渲染', async () => {
  await render(<PrivacySection />);

  expect([...container.querySelectorAll('h1')].map((node) => node.textContent)).toEqual([
    '隐私条款',
  ]);

  const sections = [...container.querySelectorAll('h2')].map((node) => node.textContent);
  expect(sections).toEqual([
    '1. 数据保存在本机',
    '2. 凭据如何保护',
    '3. 运行 Agent 时发送到模型服务的内容',
    '4. 本软件会联网的位置',
    '5. 本机记录了什么',
    '6. 本软件没有的功能',
  ]);

  const strong = expectBoldAllRendered(privacy);
  expect(strong.some((text) => text.includes('没有远程数据库'))).toBe(true);

  // 凭据文件表 5 行 + 联网位置表 13 行，两张表都和正文用同一组表格类名。
  const tables = [...container.querySelectorAll('table')];
  expect(tables.map((table) => table.querySelectorAll('tbody tr').length)).toEqual([5, 13]);
  expect(tables[0]?.querySelector('th')?.textContent).toBe('凭据文件');
});
