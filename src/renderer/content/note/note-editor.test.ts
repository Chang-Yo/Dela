// @vitest-environment jsdom
// 所见即所得内核的往返保真测试：图片 alt/title 修复、链接输入规则、常用语法第二遍稳定、
// frontmatter 会被破坏（因此该类文档强制源码模式，见 shared/note-files.ts）。
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import {
  attachLinkInputRule,
  fixImageBlockSchema,
  forgetNoteEditorState,
  NoteEditor,
} from './NoteEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { EditorView } from '@codemirror/view';

beforeAll(() => {
  // jsdom 缺少 Crepe 依赖的观察者 API，补无副作用的桩。
  class EmptyObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(globalThis, {
    IntersectionObserver: EmptyObserver,
    ResizeObserver: EmptyObserver,
  });
});

describe('编辑器 IME 回传', () => {
  it('正文不注册块拖拽手柄，保留斜杠菜单', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    root.render(
      createElement(NoteEditor, {
        documentKey: 'no-block-test',
        editorStateKey: 'no-block-test',
        value: '# 标题\n\n正文',
        onChange: () => {},
        onSave: () => {},
      }),
    );
    try {
      await vi.waitFor(() => expect(host.querySelector('.ProseMirror p')).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(host.querySelector('.milkdown-block-handle')).toBeNull();
      expect(host.querySelector('.milkdown-slash-menu')).not.toBeNull();
    } finally {
      root.unmount();
      forgetNoteEditorState('no-block-test');
      host.remove();
    }
  });
  it('富文本选词结束后不被组词期间回传的拼音覆盖', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    function ControlledNote() {
      const [value, setValue] = useState('开始');
      return createElement(NoteEditor, {
        documentKey: 'ime-test',
        editorStateKey: 'ime-test',
        value,
        onChange: (text) => {
          onChange(text);
          setValue(text);
        },
        onSave: () => {},
      });
    }
    root.render(createElement(ControlledNote));
    try {
      await vi.waitFor(() => expect(host.querySelector('.ProseMirror p')).not.toBeNull());
      const editor = host.querySelector<HTMLElement>('.ProseMirror')!;
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      editor.querySelector('p')!.textContent = '开始ni';
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('开始ni\n'));
      // 让父组件回传拼音，然后模拟输入法提交汉字的 DOM 修改。
      await new Promise((resolve) => setTimeout(resolve, 50));
      editor.querySelector('p')!.textContent = '开始你';
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你' }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(editor.textContent).toBe('开始你');
      expect(onChange).toHaveBeenLastCalledWith('开始你\n');
    } finally {
      root.unmount();
      forgetNoteEditorState('ime-test');
      host.remove();
    }
  });

  it('源码组词结束先于父组件回传时保留已提交中文，仍接收外部修改', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const props = { onChange: vi.fn(), onSave: () => {}, onScroll: () => {}, scroll: 0 };
    root.render(createElement(MarkdownEditor, { ...props, value: '' }));
    try {
      await vi.waitFor(() => expect(host.querySelector('.cm-content')).not.toBeNull());
      const content = host.querySelector<HTMLElement>('.cm-content')!;
      const view = EditorView.findFromDOM(content)!;
      view.dispatch({ changes: { from: 0, insert: '中文' }, userEvent: 'input.type.compose' });
      content.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '中文' }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(view.state.doc.toString()).toBe('中文');
      expect(props.onChange).toHaveBeenLastCalledWith('中文');
      root.render(createElement(MarkdownEditor, { ...props, value: '外部修改' }));
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe('外部修改'));
    } finally {
      root.unmount();
      host.remove();
    }
  });
});

async function makeEditor(markdown: string): Promise<{ crepe: Crepe; root: HTMLDivElement }> {
  const root = document.createElement('div');
  document.body.append(root);
  const crepe = new Crepe({ root, defaultValue: markdown });
  fixImageBlockSchema(crepe.editor);
  attachLinkInputRule(crepe.editor);
  await crepe.create();
  return { crepe, root };
}

async function roundTrip(markdown: string): Promise<string> {
  const { crepe, root } = await makeEditor(markdown);
  try {
    return crepe.getMarkdown();
  } finally {
    await crepe.destroy();
    root.remove();
  }
}

const doc = [
  '# 一级标题',
  '',
  '段落 **加粗** *斜体* `行内代码` [链接](https://example.com)。',
  '',
  '- 项目一',
  '- 项目二',
  '',
  '1. 步骤',
  '2. 继续',
  '',
  '- [ ] 待办',
  '- [x] 完成',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  '> 引用一句',
  '',
  '$E = mc^2$',
  '',
  '$$',
  '\\int_0^1 x dx',
  '$$',
].join('\n');

describe('Crepe 往返保真', () => {
  it(
    '图片 alt 文本与 title 不丢失（默认 schema 会把 alt 写成宽高比）',
    { timeout: 30_000 },
    async () => {
      const out = await roundTrip('![截图](assets/pic.png "标题")\n');
      expect(out).toContain('![截图](assets/pic.png');
      expect(out).not.toContain('![1.00]');
      expect(out).toContain('标题');
    },
  );

  it('常用语法第二遍稳定（往返后再次往返结果不变）', { timeout: 60_000 }, async () => {
    const once = await roundTrip(doc);
    const twice = await roundTrip(once);
    expect(twice).toBe(once);
    // 关键结构在第一遍就保留（无序列表符号规范化为 *，属已知序列化风格差异）。
    expect(once).toContain('# 一级标题');
    expect(once).toContain('* [ ] 待办');
    expect(once).toContain('| 列A |');
    expect(once).toContain('const x: number = 1;');
    expect(once).toContain('$E = mc^2$');
  });

  it('frontmatter 会被内核改写（此类文档必须停在源码模式）', { timeout: 30_000 }, async () => {
    const out = await roundTrip('---\ntitle: 笔记\n---\n\n正文\n');
    expect(out).not.toContain('---\ntitle:');
  });

  it(
    '输入 [文本](地址) 在键入 ) 时经输入规则转为链接（Milkdown 未内置）',
    { timeout: 30_000 },
    async () => {
      const { crepe, root } = await makeEditor('');
      try {
        const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
        const typed = '[link](https://baidu.com)';
        // handleTextInput 的类型声明比运行时多一个可选参数，这里按运行时签名调用。
        const handled = view.someProp('handleTextInput', (apply) =>
          (apply as (v: unknown, from: number, to: number, text: string) => boolean)(
            view,
            0,
            0,
            typed,
          ),
        );
        expect(handled).toBe(true);
        let found = false;
        view.state.doc.descendants((node) => {
          if (
            node.isText &&
            node.text === 'link' &&
            node.marks.some(
              (mark) => mark.type.name === 'link' && mark.attrs.href === 'https://baidu.com',
            )
          )
            found = true;
        });
        expect(found).toBe(true);
        expect(view.state.doc.textContent).not.toContain('](https://baidu.com)');
      } finally {
        await crepe.destroy();
        root.remove();
      }
    },
  );

  it('原始 HTML、HTML 注释与脚注原样保留', { timeout: 30_000 }, async () => {
    const raw = [
      '<div class="card">原始块</div>',
      '',
      '<!-- 构建注释 -->',
      '',
      '正文与脚注[^1]。',
      '',
      '[^1]: 脚注内容',
      '',
    ].join('\n');
    const out = await roundTrip(raw);
    expect(out).toContain('<div class="card">原始块</div>');
    expect(out).toContain('<!-- 构建注释 -->');
    expect(out).toContain('[^1]: 脚注内容');
  });
});
