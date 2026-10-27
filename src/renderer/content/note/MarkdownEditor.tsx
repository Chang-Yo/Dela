import { useEffect, useRef, useState } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { useEditorSettings } from '../editor-settings';
import { codeHighlightStyle, markdownHighlightStyle } from '../../lib/syntax-highlight';
import { markdownLivePreview } from './live-preview';
import { formatByName } from '../../../shared/files';

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.875rem',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.625',
    padding: '1.5rem',
  },
  // 与富文本（note-editor.css 的 60rem 居中）一致，超宽窗口下行宽不无限拉伸。
  '.cm-content': { caretColor: 'var(--syntax-caret)', maxWidth: '60rem', margin: '0 auto' },
  '&.cm-source-file .cm-scroller': { padding: '1.5rem 0' },
  '&.cm-source-file .cm-content': {
    maxWidth: 'none',
    margin: '0',
    paddingRight: '1.5rem',
    textAlign: 'left',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--syntax-caret)' },
  '.cm-placeholder': { color: 'var(--color-muted-foreground)' },
  // 行号栏横向滚动时 sticky：背景必须不透明并接管左侧留白，否则长行会从行号下透出。
  '.cm-scroller:has(.cm-gutters)': { paddingLeft: '0' },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-muted-foreground)',
    paddingLeft: '1.5rem',
  },
  '&.cm-source-file .cm-gutters': { borderRight: '1px solid var(--color-border)' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', padding: '0 0.5rem 0 0.25rem' },
});

type ResolvedLanguage =
  { kind: 'markdown' } | { kind: 'code'; language: LanguageDescription } | { kind: 'text' };

const languageConf = new Compartment();
const placeholderConf = new Compartment();
const wrappingConf = new Compartment();
const layoutConf = new Compartment();
const contentAttributesConf = new Compartment();
const previewConf = new Compartment();
const readOnlyConf = new Compartment();
const externalSync = Annotation.define<boolean>();

type EditorHandlers = {
  onChange: (text: string) => void;
  onSave: () => void;
  onScroll: (top: number) => void;
  sync: () => void;
  onCursor: (cursor: { line: number; column: number }) => void;
};

type EditorSession = { state: EditorState; scrollTop: number };

/* EditorState lives outside the React tree so switching tabs does not throw away
   undo history or the cursor. Each editor group passes a different key. */
const sessions = new Map<string, EditorSession>();
const handlers = new Map<string, EditorHandlers>();
let nextEditorId = 0;

function replaceDocument(current: string, next: string) {
  let from = 0;
  while (from < current.length && from < next.length && current[from] === next[from]) from += 1;
  let currentEnd = current.length;
  let nextEnd = next.length;
  while (currentEnd > from && nextEnd > from && current[currentEnd - 1] === next[nextEnd - 1]) {
    currentEnd -= 1;
    nextEnd -= 1;
  }
  return { from, to: currentEnd, insert: next.slice(from, nextEnd) };
}

/** 换行符跟随文件：CodeMirror 默认把任何换行都拆成行、再以 \n 拼回，CRLF 文件改一个字就整篇变 LF。
 *  按第一个换行判定（与 VS Code 一致），新输入的行沿用它；混用换行的文件里另一种会被统一。
 *  装配时只取一次：同一个编辑器会话里换行风格不变。 */
export function lineSeparatorOf(text: string): '\r\n' | '\n' {
  const first = text.indexOf('\n');
  return first > 0 && text[first - 1] === '\r' ? '\r\n' : '\n';
}

/** 不传文件名（水源回复等撰写框）按 Markdown；文件按名字找语言，Dockerfile/Makefile 这类无后缀名也能匹配。 */
function languageForFilename(filename: string | undefined): ResolvedLanguage {
  if (!filename) return { kind: 'markdown' };
  if (formatByName(filename) === 'markdown') return { kind: 'markdown' };
  const language = LanguageDescription.matchFilename(languages, filename);
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
  editorStateKey,
  livePreview,
  readOnly = false,
  extensions: extraExtensions = [],
}: {
  value: string;
  filename?: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onScroll: (top: number) => void;
  /* scroll 与 lineNumbers/ariaLabel/saveOnBlur 仅取初值：只装配于首次挂载，此后变化不生效。 */
  scroll: number;
  /** 占位文案；回复编辑器等非笔记场景使用，变化时热替换。 */
  placeholderText?: string;
  /** 行号 gutter；笔记默认开启，回复编辑器可关闭。 */
  lineNumbers?: boolean;
  ariaLabel?: string;
  /** 失焦即保存是笔记语义；回复编辑器传 false 防止误触发发送。 */
  saveOnBlur?: boolean;
  /** 传入后在切换标签时保留撤销历史、光标和滚动位置。每个编辑器组应使用不同值。 */
  editorStateKey?: string;
  /** Markdown 即时渲染：传入相对图片的显示地址解析；不传为纯源码。仅取初值。 */
  livePreview?: (src: string) => string;
  /** 只读：仍可聚焦、搜索与复制（超过编辑上限或远端文件）。 */
  readOnly?: boolean;
  /** 调用方附加的扩展（如 Markdown 文件的图片粘贴）；仅取初值。 */
  extensions?: Extension[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const instanceKey = useRef(editorStateKey ?? `markdown-editor-${nextEditorId++}`).current;
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const wordWrap = useEditorSettings((state) => state.wordWrap);
  const handlersRef = useRef({ onChange, onSave, onScroll });
  handlersRef.current = { onChange, onSave, onScroll };
  const latestValue = useRef(value);
  const lastPublishedValue = useRef<string | null>(null);
  const publishChange = (text: string) => {
    lastPublishedValue.current = text;
    // 组词结束的定时回调可能早于 React 提交新的 value。
    latestValue.current = text;
    handlersRef.current.onChange(text);
  };
  /* 外部值同步：IME 组文期间全量替换文档会打断输入法，推迟到组文结束后再补。 */
  const syncValue = () => {
    const current = view.current;
    if (!current) return;
    if (latestValue.current === lastPublishedValue.current) return;
    const text = current.state.sliceDoc();
    if (latestValue.current === text) return;
    if (current.compositionStarted) {
      return;
    }
    lastPublishedValue.current = null;
    current.dispatch({
      changes: replaceDocument(text, latestValue.current),
      annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
    });
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
    const persistent = editorStateKey !== undefined;
    const transient: { current?: EditorSession } = {};
    const previous = persistent ? sessions.get(instanceKey) : undefined;
    const extensions: Extension[] = [
      EditorState.lineSeparator.of(lineSeparatorOf(value)),
      history(),
      languageConf.of(
        initial.kind === 'markdown'
          ? markdown({ base: markdownLanguage, codeLanguages: languages })
          : [],
      ),
      // 即时渲染自己给正文上样式；只有看原文时才按 Ayu 给 Markdown 正文着色。
      previewConf.of(
        livePreview && initial.kind === 'markdown'
          ? markdownLivePreview(livePreview)
          : syntaxHighlighting(markdownHighlightStyle),
      ),
      readOnlyConf.of(EditorState.readOnly.of(readOnly)),
      ...extraExtensions,
      ...(showLineNumbers ? [lineNumbers()] : []),
      wrappingConf.of(wordWrap ? EditorView.lineWrapping : []),
      layoutConf.of(
        EditorView.editorAttributes.of({
          class: initial.kind === 'markdown' ? '' : 'cm-source-file',
        }),
      ),
      placeholderConf.of(placeholder(placeholderText)),
      search({ top: true }),
      keymap.of([
        ...markdownKeymap,
        {
          key: 'Mod-s',
          run: () => {
            handlers.get(instanceKey)?.onSave();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            handlers.get(instanceKey)?.onSave();
            return true;
          },
        },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      editorTheme,
      syntaxHighlighting(codeHighlightStyle),
      contentAttributesConf.of(
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          'aria-label': ariaLabel,
        }),
      ),
      EditorView.updateListener.of((update) => {
        const session = sessions.get(instanceKey) ?? transient.current;
        if (session) session.state = update.state;
        if (update.selectionSet) {
          const position = update.state.doc.lineAt(update.state.selection.main.head);
          handlers.get(instanceKey)?.onCursor({
            line: position.number,
            column: update.state.selection.main.head - position.from + 1,
          });
        }
        if (
          update.docChanged &&
          !update.transactions.some((transaction) => transaction.annotation(externalSync))
        )
          handlers.get(instanceKey)?.onChange(update.state.sliceDoc());
      }),
      EditorView.domEventHandlers({
        blur: () => {
          if (saveOnBlur) handlers.get(instanceKey)?.onSave();
          return false;
        },
        // 组文结束后（CM6 微任务冲完组文变更）补一次被跳过的外部值同步。
        compositionend: () => {
          window.setTimeout(() => handlers.get(instanceKey)?.sync(), 0);
          return false;
        },
      }),
    ];
    let state = previous?.state;
    if (!state) state = EditorState.create({ doc: value, extensions });
    else if (state.sliceDoc() !== value)
      state = state.update({
        changes: replaceDocument(state.sliceDoc(), value),
        annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
      }).state;
    const session: EditorSession = { state, scrollTop: previous?.scrollTop ?? scroll };
    transient.current = session;
    if (persistent) sessions.set(instanceKey, session);
    const current = new EditorView({ parent: host.current!, state });
    current.scrollDOM.scrollTop = session.scrollTop;
    const updateCursor = () => {
      const position = current.state.doc.lineAt(current.state.selection.main.head);
      setCursor({
        line: position.number,
        column: current.state.selection.main.head - position.from + 1,
      });
    };
    const onScroll = () => {
      session.scrollTop = current.scrollDOM.scrollTop;
      handlers.get(instanceKey)?.onScroll(current.scrollDOM.scrollTop);
    };
    const boundHandlers: EditorHandlers = {
      onChange: publishChange,
      onSave: handlersRef.current.onSave,
      onScroll: handlersRef.current.onScroll,
      sync: syncValue,
      onCursor: setCursor,
    };
    handlers.set(instanceKey, boundHandlers);
    current.scrollDOM.addEventListener('scroll', onScroll);
    view.current = current;
    updateCursor();
    current.dispatch({
      effects: languageConf.reconfigure(
        initial.kind === 'markdown'
          ? markdown({ base: markdownLanguage, codeLanguages: languages })
          : [],
      ),
    });
    if (initial.kind === 'code') loadLanguage(current, initial.language, filename);
    return () => {
      if (!persistent || sessions.get(instanceKey) === session) {
        session.state = current.state;
        session.scrollTop = current.scrollDOM.scrollTop;
      }
      current.scrollDOM.removeEventListener('scroll', onScroll);
      current.destroy();
      view.current = null;
      if (handlers.get(instanceKey)?.sync === boundHandlers.sync) handlers.delete(instanceKey);
    };
    // value/filename/scroll 只在首次挂载装配；后续外部变更由下方 effect 单向同步。
  }, []);
  useEffect(() => {
    view.current?.dispatch({
      effects: wrappingConf.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);
  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlyConf.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);
  /* aria-label 变化时重建 compartment 内容；拼写检查恒为关，与聊天输入框一致。 */
  useEffect(() => {
    view.current?.dispatch({
      effects: contentAttributesConf.reconfigure(
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          'aria-label': ariaLabel,
        }),
      ),
    });
  }, [ariaLabel]);
  useEffect(() => {
    view.current?.dispatch({
      effects: layoutConf.reconfigure(
        EditorView.editorAttributes.of({
          class: languageForFilename(filename).kind === 'markdown' ? '' : 'cm-source-file',
        }),
      ),
    });
  }, [filename]);
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const bound = handlers.get(instanceKey);
    if (bound) handlers.set(instanceKey, { ...bound, onChange: publishChange, onSave, onScroll });
  }, [onChange, onSave, onScroll, instanceKey]);
  useEffect(() => {
    latestValue.current = value;
    syncValue();
  }, [value]);
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
      apply(
        resolved.kind === 'markdown'
          ? markdown({ base: markdownLanguage, codeLanguages: languages })
          : [],
      );
    }
  }, [filename]);
  /* 占位文案热替换；重挂载复用 session 携带旧值时也在此纠正。 */
  useEffect(() => {
    view.current?.dispatch({
      effects: placeholderConf.reconfigure(placeholder(placeholderText)),
    });
  }, [placeholderText]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div ref={host} className="min-h-0 w-full flex-1 overflow-hidden" />
      {editorStateKey !== undefined && (
        <div className="flex h-6 shrink-0 items-center justify-end border-t px-3 text-xs text-ink-3">
          行 {cursor.line}，列 {cursor.column}
        </div>
      )}
    </div>
  );
}
