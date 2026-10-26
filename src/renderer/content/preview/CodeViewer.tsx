import { useEffect, useRef } from 'react';
import { defaultKeymap } from '@codemirror/commands';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { useEditorSettings } from '../editor-settings';
import { codeHighlightStyle } from '../../lib/syntax-highlight';

const viewerTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.875rem',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.625',
    padding: '1.5rem 0',
  },
  '.cm-content': {
    caretColor: 'var(--syntax-caret)',
    margin: '0',
    paddingRight: '1.5rem',
    textAlign: 'left',
  },
  // 行号栏在横向滚动时是 sticky 的：背景必须不透明并覆盖左侧留白，否则长行会从行号下透出。
  '.cm-gutters': {
    borderRight: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-muted-foreground)',
    paddingLeft: '1.5rem',
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', padding: '0 0.5rem 0 0.25rem' },
});

/** 按文件名匹配语言：Dockerfile、Makefile 这类无后缀名也能命中。 */
function languageForFilename(filename: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, filename);
}

/**
 * 只读代码/文本文件查看器：CodeMirror 只读装配，滚动位置由上层按标签记忆。
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
  const wrappingConf = useRef(new Compartment()).current;
  const wordWrap = useEditorSettings((state) => state.wordWrap);

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
          wrappingConf.of(wordWrap ? EditorView.lineWrapping : []),
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

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrappingConf.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap, wrappingConf]);

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
