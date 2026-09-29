import { useEffect, useRef } from 'react';
import { defaultKeymap } from '@codemirror/commands';
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

/* 代码高亮配色与 note 域编辑器共用同一套 --syntax-* token（GitHub Light/Dark，
   定义在 styles/globals.css，随系统明暗主题翻转）；标签按代码文件所需取子集。 */
const codeHighlightStyle = HighlightStyle.define([
  {
    tag: [t.comment, t.meta, t.annotation, t.processingInstruction],
    color: 'var(--syntax-comment)',
  },
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
    color: 'var(--syntax-keyword)',
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syntax-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.escape], color: 'var(--syntax-constant)' },
  {
    tag: [t.function(t.variableName), t.function(t.definition(t.variableName)), t.macroName],
    color: 'var(--syntax-function)',
  },
  {
    tag: [t.definition(t.variableName), t.typeName, t.className, t.namespace],
    color: 'var(--syntax-variable)',
  },
  {
    tag: [t.propertyName, t.special(t.propertyName), t.attributeName],
    color: 'var(--syntax-constant)',
  },
  { tag: t.tagName, color: 'var(--syntax-tag)' },
]);

/* 版式与 note 域 MarkdownEditor 同款：透明底、60rem 居中行宽、无框行号。 */
const viewerTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'calc(14px * var(--font-scale, 1))',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.625',
    padding: '24px',
  },
  '.cm-content': { caretColor: 'var(--syntax-caret)', maxWidth: '60rem', margin: '0 auto' },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--color-muted-foreground)',
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', padding: '0 8px 0 4px' },
});

/* 文件名 → 语言：无扩展名按纯文本；语言包经 language-data 异步加载。 */
function languageForFilename(filename: string): LanguageDescription | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return languages.find((l) => l.extensions.includes(ext)) ?? null;
}

/**
 * 只读代码/文本文件查看器（原 ProjectDocument 的文本分支）：CodeMirror 只读装配，
 * 语法高亮、行号、搜索面板与原生复制；滚动位置由上层按标签记忆。
 */
export function CodeViewer({
  value,
  filename,
  scroll,
  onScroll,
}: {
  value: string;
  filename: string;
  scroll: number;
  onScroll: (top: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const element = host.current!;
    const languageConf = new Compartment();
    const view = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: value,
        extensions: [
          // 只读仅锁事务不改 editable：保持可聚焦，搜索面板与键盘选择/复制可用。
          EditorState.readOnly.of(true),
          languageConf.of([]),
          lineNumbers(),
          EditorView.lineWrapping,
          search({ top: true }),
          keymap.of([...searchKeymap, ...defaultKeymap]),
          viewerTheme,
          syntaxHighlighting(codeHighlightStyle),
        ],
      }),
    });
    view.scrollDOM.scrollTop = scroll;
    const handleScroll = () => onScroll(view.scrollDOM.scrollTop);
    view.scrollDOM.addEventListener('scroll', handleScroll);
    viewRef.current = view;
    const language = languageForFilename(filename);
    if (language) {
      void language.load().then((support) => {
        if (viewRef.current === view) view.dispatch({ effects: languageConf.reconfigure(support) });
      });
    }
    return () => {
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      viewRef.current = null;
      view.destroy();
    };
    // value/filename/scroll 仅取初值：标签切换由上层重挂载，外部重读走下方同步。
  }, []);

  /* 聚焦刷新等外部重读后的整篇替换：保持滚动位置，不计入编辑（只读本无编辑）。 */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    view.scrollDOM.scrollTop = scrollTop;
  }, [value]);

  return <div ref={host} className="min-h-0 w-full flex-1 overflow-hidden" />;
}
