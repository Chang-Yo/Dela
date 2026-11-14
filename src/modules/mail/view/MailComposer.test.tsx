// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, PreparedEmail } from '../../../shared/api';
import { MailComposer } from './MailComposer';

vi.mock('../../app/toasts', () => ({ showToast: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
let saveDraft: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn>;
let commandState: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  saveDraft = vi.fn(async (_input: unknown) => ({ id: 'saved' }));
  sendMessage = vi.fn(async (_input: unknown) => ({ ok: true }));
  commandState = vi.fn(() => false);
  Object.defineProperty(document, 'queryCommandState', { configurable: true, value: commandState });
  window.dela = {
    session: { onRunEvent: () => () => {} },
    mail: {
      saveDraft,
      sendMessage,
      deleteDraft: async () => {},
      setComposeActive: async () => {},
      onRequestClose: () => () => {},
      releaseComposeFiles: async () => {},
    },
  } as unknown as DelaApi;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (document as Partial<Document>).queryCommandState;
  delete window.dela;
  vi.unstubAllGlobals();
});

async function mount(html?: string, text = '正文', files: PreparedEmail['files'] = []) {
  const draft: PreparedEmail = {
    id: 'draft',
    to: ['recipient@example.invalid'],
    subject: '格式检查',
    html,
    text,
    files,
  };
  await act(async () =>
    root.render(
      <MailComposer
        accountAddress="sender@example.invalid"
        draft={draft}
        onClose={() => {}}
        onDirtyChange={() => {}}
        onSent={() => {}}
      />,
    ),
  );
  return container.querySelector<HTMLDivElement>('[contenteditable]')!;
}

async function save() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="保存草稿"]')!.click(),
  );
  return saveDraft.mock.calls.at(-1)![0] as {
    html: string;
    text: string;
    inlineImageIds: string[];
  };
}

it('加粗、斜体与链接经过草稿恢复、保存、发送后保持一致', async () => {
  const editor = await mount(
    '<p><b>加粗 <i>斜体</i></b></p><p><a href="https://example.invalid/path">链接</a></p>',
  );
  expect(editor.querySelector('b i')?.textContent).toBe('斜体');
  const saved = await save();
  expect(saved.html).toContain('<b>加粗 <i>斜体</i></b>');
  expect(saved.text).toBe('加粗 斜体\n\n链接 [https://example.invalid/path]');
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(sendMessage.mock.calls[0]![0]).toMatchObject({ html: saved.html, text: saved.text });
  expect(saved.html).not.toContain('font-synthesis');
});

it.each([
  ['first<div>second<br>third</div>', 'first\nsecond\nthird'],
  ['first<div><br></div><div>third</div>', 'first\n\nthird'],
  ['<p>first</p><p>second</p>', 'first\n\nsecond'],
])('保存正文保留块元素和换行：%s', async (html, expected) => {
  await mount(html);
  expect((await save()).text).toBe(expected);
});

it('纯文本草稿恢复为可见换行，保存后不把多行连在一起', async () => {
  const editor = await mount(undefined, 'first\r\nsecond\r\nthird');
  expect(editor.querySelectorAll('br')).toHaveLength(2);
  expect((await save()).text).toBe('first\nsecond\nthird');
});

it('内联图片恢复为预览，发送数据仍用 CID 并保留周围格式', async () => {
  const editor = await mount(
    '<i>图片前</i><img src="cid:image@dela" alt="说明"><b>图片后</b>',
    '正文',
    [
      {
        id: 'image',
        name: 'test.gif',
        size: 1,
        kind: 'inline',
        previewUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      },
    ],
  );
  expect(editor.querySelector('img')?.getAttribute('src')).toMatch(/^data:/);
  const saved = await save();
  expect(saved.html).toContain('src="cid:image@dela"');
  expect(saved.html).toContain('<i>图片前</i>');
  expect(saved.html).toContain('<b>图片后</b>');
  expect(saved.inlineImageIds).toEqual(['image']);
});

it('只有 selectionchange 时工具栏也跟随实际格式状态更新', async () => {
  const editor = await mount('<i>italic</i> normal');
  const range = document.createRange();
  range.selectNodeContents(editor.querySelector('i')!);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  commandState.mockImplementation((command: string) => command === 'italic');
  await act(async () => document.dispatchEvent(new Event('selectionchange')));
  expect(container.querySelector('[aria-label="斜体"]')?.getAttribute('aria-pressed')).toBe('true');
  commandState.mockReturnValue(false);
  range.selectNodeContents(editor);
  await act(async () => document.dispatchEvent(new Event('selectionchange')));
  expect(container.querySelector('[aria-label="斜体"]')?.getAttribute('aria-pressed')).toBe(
    'false',
  );
});
