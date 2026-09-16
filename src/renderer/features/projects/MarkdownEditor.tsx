import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
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

/* 文件名 → 语言：空、无扩展名或 md/markdown 维持 Markdown；其余扩展名按
   language-data 解析（语言包异步加载），解析不到按纯文本。 */
type ResolvedLanguage =
  { kind: 'markdown' } | { kind: 'code'; language: LanguageDescription } | { kind: 'text' };

const languageConf = new Compartment();

function languageForFilename(filename: string | undefined): ResolvedLanguage {
  if (!filename) return { kind: 'markdown' };
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  if (!ext || ext === filename.toLowerCase() || ext === 'md' || ext === 'markdown')
    return { kind: 'markdown' };
  const language = languages.find((l) => l.extensions.includes(ext));
  return language ? { kind: 'code', language } : { kind: 'text' };
}

export function MarkdownEditor({
  value,
  filename,
  onChange,
  onSave,
  onScroll,
  scroll,
  placeholderText = '开始记录…',
  lineNumbers: showLineNumbers = true,
  ariaLabel = '笔记编辑器',
  saveOnBlur = true,
}: {
  value: string;
  filename?: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onScroll: (top: number) => void;
  scroll: number;
  /** 占位文案；回复编辑器等非笔记场景使用。 */
  placeholderText?: string;
  /** 行号 gutter；笔记默认开启，回复编辑器可关闭。 */
  lineNumbers?: boolean;
  ariaLabel?: string;
  /** 失焦即保存是笔记语义；回复编辑器传 false 防止误触发发送。 */
  saveOnBlur?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onSave, onScroll });
  handlers.current = { onChange, onSave, onScroll };
  const latestValue = useRef(value);
  latestValue.current = value;
  const pendingValueSync = useRef(false);
  /* 外部值同步：IME 组文期间全量替换文档会打断输入法，推迟到组文结束后再补。 */
  const syncValue = () => {
    const current = view.current;
    if (!current) return;
    const text = current.state.doc.toString();
    if (latestValue.current === text) {
      pendingValueSync.current = false;
      return;
    }
    if (current.compositionStarted) {
      pendingValueSync.current = true;
      return;
    }
    pendingValueSync.current = false;
    current.dispatch({ changes: { from: 0, to: text.length, insert: latestValue.current } });
  };
  const appliedFilename = useRef(filename);
  /* 异步加载语言包后挂载到 languageConf；视图销毁或文件名已切换则丢弃。 */
  const loadLanguage = (
    current: EditorView,
    language: LanguageDescription,
    name: string | undefined,
  ) => {
    void language.load().then((support) => {
      if (view.current === current && appliedFilename.current === name)
        current.dispatch({ effects: languageConf.reconfigure(support) });
    });
  };
  useEffect(() => {
    const initial = languageForFilename(filename);
    const current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          languageConf.of(
            initial.kind === 'markdown' ? markdown({ codeLanguages: languages }) : [],
          ),
          ...(showLineNumbers ? [lineNumbers()] : []),
          EditorView.lineWrapping,
          placeholder(placeholderText),
          keymap.of([
            ...markdownKeymap,
            {
              key: 'Mod-s',
              run: () => {
                handlers.current.onSave();
                return true;
              },
            },
            {
              key: 'Mod-Enter',
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
          EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => {
              if (saveOnBlur) handlers.current.onSave();
              return false;
            },
            // 组文结束后（CM6 微任务冲完组文变更）补一次被跳过的外部值同步。
            compositionend: () => {
              setTimeout(() => {
                if (pendingValueSync.current) syncValue();
              }, 0);
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
    if (initial.kind === 'code') loadLanguage(current, initial.language, filename);
    return () => {
      view.current = null;
      current.destroy();
    };
    // value/filename/scroll 初始装配一次（代码语言的异步加载见 loadLanguage）；
    // 此后由下方 effect 单向同步外部变更。
  }, []);
  useEffect(() => {
    syncValue();
  }, [value]);
  /* 同实例切换文件名时切换语言；语言包经 language-data 异步加载完成后 reconfigure。 */
  useEffect(() => {
    const current = view.current;
    if (!current || appliedFilename.current === filename) return;
    appliedFilename.current = filename;
    const apply = (extension: Extension) => {
      if (view.current === current && appliedFilename.current === filename)
        current.dispatch({ effects: languageConf.reconfigure(extension) });
    };
    const resolved = languageForFilename(filename);
    if (resolved.kind === 'code') {
      apply([]); // 语言加载期间先回到纯文本，不沿用上一文档的语言解析
      loadLanguage(current, resolved.language, filename);
    } else {
      apply(resolved.kind === 'markdown' ? markdown({ codeLanguages: languages }) : []);
    }
  }, [filename]);
  return <div ref={host} className="min-h-0 w-full flex-1 overflow-hidden" />;
}
