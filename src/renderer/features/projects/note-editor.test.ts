// @vitest-environment jsdom
// 所见即所得内核的往返保真测试：图片 alt/title 修复、链接输入规则、常用语法第二遍稳定、
// frontmatter 会被破坏（因此该类文档强制源码模式，见 shared/note-files.ts）。
import { beforeAll, describe, expect, it } from 'vitest';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { attachLinkInputRule, fixImageBlockSchema } from './NoteEditor';

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
