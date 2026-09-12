import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/* 语法高亮配色（GitHub Light/Dark，Primer prettylights）：色值定义在
   styles/globals.css 的 --syntax-*，跟随系统明暗主题，无需在此区分。 */
const highlightStyle = HighlightStyle.define([
  { tag: t.heading, color: 'var(--syntax-constant)', fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--syntax-string)', textDecoration: 'underline' },
  { tag: [t.url, t.monospace], color: 'var(--syntax-string)' },
  {
    tag: [t.quote, t.processingInstruction, t.contentSeparator],
    color: 'var(--syntax-comment)',
  },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: 'var(--syntax-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syntax-string)' },
  { tag: t.regexp, color: 'var(--syntax-tag)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.escape], color: 'var(--syntax-constant)' },
  {
    tag: [t.function(t.variableName), t.function(t.definition(t.variableName))],
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
  { tag: [t.meta, t.annotation], color: 'var(--syntax-comment)' },
  { tag: t.comment, color: 'var(--syntax-comment)' },
]);

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.625',
    padding: '24px',
  },
  '.cm-content': { caretColor: 'var(--syntax-caret)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--syntax-caret)' },
  '.cm-placeholder': { color: 'var(--color-muted-foreground)' },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--color-muted-foreground)',
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', padding: '0 8px 0 4px' },
});

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onScroll,
  scroll,
}: {
  value: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onScroll: (top: number) => void;
  scroll: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onSave, onScroll });
  handlers.current = { onChange, onSave, onScroll };
  useEffect(() => {
    const current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown({ codeLanguages: languages }),
          lineNumbers(),
          EditorView.lineWrapping,
          placeholder('开始记录…'),
          keymap.of([
            ...markdownKeymap,
            {
              key: 'Mod-s',
              run: () => {
                handlers.current.onSave();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          editorTheme,
          syntaxHighlighting(highlightStyle),
          EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': '笔记编辑器' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => {
              handlers.current.onSave();
              return false;
            },
          }),
        ],
      }),
    });
    current.scrollDOM.scrollTop = scroll;
    current.scrollDOM.addEventListener('scroll', () =>
      handlers.current.onScroll(current.scrollDOM.scrollTop),
    );
    view.current = current;
    return () => {
      view.current = null;
      current.destroy();
    };
    // value 初始装配一次；此后由下方 effect 单向同步外部变更。
  }, []);
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const text = current.state.doc.toString();
    if (value !== text) current.dispatch({ changes: { from: 0, to: text.length, insert: value } });
  }, [value]);
  return <div ref={host} className="min-h-0 w-full flex-1 overflow-hidden" />;
}
