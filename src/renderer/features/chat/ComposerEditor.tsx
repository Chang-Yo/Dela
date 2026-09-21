import { useEffect, useRef, type RefObject } from 'react';
import {
  defaultKeymap,
  history,
  historyKeymap,
  insertNewlineAndIndent,
} from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { matchChatImageTokens } from '../../../shared/chat-input';
import { markdownHighlightStyle } from '../projects/MarkdownEditor';
import { getChatMediaPreview } from './media';

/** 容器注入的菜单键盘协议：返回 true 表示已消费该按键。 */
export type ComposerMenuApi = {
  onKey: (key: 'down' | 'up' | 'select' | 'close') => boolean;
};

export type ComposerEditorHandle = {
  focus: () => void;
  /** 在指定位置插入文本并把光标移到其后（内联图片 token 用）。 */
  insertAt: (pos: number, text: string) => void;
  replaceRange: (from: number, to: number, text: string) => void;
  selectionStart: () => number;
};

type EditorHandlers = {
  onChange: (text: string) => void;
  onSend: () => void;
  onCaret: (text: string, caret: number) => void;
  onFiles: (files: File[], pos: number) => void;
  onDropHandled?: () => void;
  menu: ComposerMenuApi;
};

/** 内联图片 chip：预览缩略图 + 移除按钮，替换 ![…](dela-img:id) token 的显示。 */
class InlineImageWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }

  eq(other: InlineImageWidget) {
    return other.id === this.id;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'dela-chat-image';
    const preview = getChatMediaPreview(this.id);
    if (preview) {
      const image = document.createElement('img');
      image.src = preview;
      image.alt = this.name;
      image.draggable = false;
      wrap.appendChild(image);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'dela-chat-image-fallback';
      fallback.textContent = this.name || '图片';
      wrap.appendChild(fallback);
    }
    const remove = document.createElement('button');
    remove.setAttribute('aria-label', `移除图片 ${this.name || ''}`);
    remove.textContent = '×';
    remove.type = 'button';
    // 阻止点击时编辑器失焦。
    remove.addEventListener('mousedown', (event) => event.preventDefault());
    remove.addEventListener('click', () => {
      // 每次从当前文档重新定位 token，不缓存可能因编辑失效的区间。
      const text = view.state.doc.toString();
      const match = new RegExp(`!\\[[^\\]\\n]*\\]\\(dela-img:${this.id}\\)`).exec(text);
      if (match)
        view.dispatch({ changes: { from: match.index, to: match.index + match[0].length } });
    });
    wrap.appendChild(remove);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function imageDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const match of matchChatImageTokens(view.state.doc.toString())) {
    const from = match.index ?? 0;
    builder.add(
      from,
      from + match[0].length,
      Decoration.replace({ widget: new InlineImageWidget(match[2]!, match[1] ?? '') }),
    );
  }
  return builder.finish();
}

const imagePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = imageDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = imageDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

const composerTheme = EditorView.theme({
  '&': { fontSize: 'calc(14px * var(--font-scale, 1))', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.65',
    overflowY: 'auto',
    maxHeight: '224px',
    padding: '14px 16px 6px',
  },
  '.cm-content': { caretColor: 'inherit' },
  '.cm-placeholder': { color: 'var(--color-muted-foreground)' },
  '.dela-chat-image': {
    position: 'relative',
    display: 'inline-flex',
    verticalAlign: 'bottom',
    margin: '2px 0',
  },
  '.dela-chat-image img': {
    display: 'block',
    maxHeight: '76px',
    maxWidth: '180px',
    borderRadius: '8px',
    border: '1px solid var(--color-border)',
  },
  '.dela-chat-image-fallback': {
    display: 'inline-block',
    maxWidth: '160px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '4px 10px',
    borderRadius: '8px',
    border: '1px dashed var(--color-border)',
    color: 'var(--color-muted-foreground)',
    fontSize: '12px',
  },
  '.dela-chat-image button': {
    position: 'absolute',
    top: '-7px',
    right: '-7px',
    display: 'grid',
    placeItems: 'center',
    width: '16px',
    height: '16px',
    borderRadius: '9999px',
    backgroundColor: 'var(--color-background)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-muted-foreground)',
    fontFamily: 'inherit',
    fontSize: '11px',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.dela-chat-image button:hover': { color: 'var(--color-foreground)' },
});

const heroTheme = EditorView.theme({
  '.cm-content': { minHeight: '64px' },
});

function filesFromTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  for (const item of transfer.items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

/** 对话输入编辑器：Markdown 语法高亮、内联图片、Enter 发送（IME 安全）、文件粘贴/拖放。 */
export function ComposerEditor({
  value,
  onChange,
  onSend,
  onCaret,
  onFiles,
  onDropHandled,
  menu,
  placeholderText,
  hero = false,
  handleRef,
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onCaret: (text: string, caret: number) => void;
  onFiles: (files: File[], pos: number) => void;
  onDropHandled?: () => void;
  menu: ComposerMenuApi;
  placeholderText: string;
  hero?: boolean;
  handleRef: RefObject<ComposerEditorHandle | null>;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef<EditorHandlers>({
    onChange,
    onSend,
    onCaret,
    onFiles,
    onDropHandled,
    menu,
  });
  handlers.current = { onChange, onSend, onCaret, onFiles, onDropHandled, menu };
  const latestValue = useRef(value);
  latestValue.current = value;
  // 外部值同步（发送失败恢复等）：IME 组文期间全量替换会打断输入法，此时丢弃外部变更，
  // 以用户输入为准（后续 onChange 会把草稿收敛回编辑器内容）。
  const syncValue = () => {
    const current = view.current;
    if (!current) return;
    if (latestValue.current === current.state.doc.toString()) return;
    if (current.compositionStarted) return;
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: latestValue.current },
    });
  };

  useEffect(() => {
    const current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown({ codeLanguages: languages }),
          EditorView.lineWrapping,
          placeholder(placeholderText),
          imagePlugin,
          EditorView.atomicRanges.of(
            (target) => target.plugin(imagePlugin)?.decorations ?? Decoration.none,
          ),
          Prec.highest(
            keymap.of([
              // 候选菜单打开时接管方向键/Enter/Tab/Esc；返回 false 回落到默认行为。
              { key: 'ArrowDown', run: () => handlers.current.menu.onKey('down') },
              { key: 'ArrowUp', run: () => handlers.current.menu.onKey('up') },
              { key: 'Escape', run: () => handlers.current.menu.onKey('close') },
              { key: 'Tab', run: () => handlers.current.menu.onKey('select') },
              {
                key: 'Enter',
                run: (target) => {
                  // IME 组文中的 Enter 是候选词操作，不发送。
                  if (target.compositionStarted) return false;
                  if (handlers.current.menu.onKey('select')) return true;
                  handlers.current.onSend();
                  return true;
                },
              },
              // Shift+Enter 换行并续写列表等 Markdown 标记。
              { key: 'Shift-Enter', run: insertNewlineContinueMarkup },
              { key: 'Shift-Enter', run: insertNewlineAndIndent },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          composerTheme,
          hero ? heroTheme : [],
          syntaxHighlighting(markdownHighlightStyle),
          EditorView.contentAttributes.of({ 'aria-label': '发送给助手', spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
            if (update.docChanged || update.selectionSet)
              handlers.current.onCaret(
                update.state.doc.toString(),
                update.state.selection.main.head,
              );
          }),
          EditorView.domEventHandlers({
            paste: (event, target) => {
              const files = filesFromTransfer(event.clipboardData);
              if (!files.length) return false;
              event.preventDefault();
              handlers.current.onFiles(files, target.state.selection.main.head);
              return true;
            },
            drop: (event, target) => {
              const files = filesFromTransfer(event.dataTransfer);
              if (!files.length) return false;
              event.preventDefault();
              event.stopPropagation();
              const pos =
                target.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                target.state.selection.main.head;
              handlers.current.onFiles(files, pos);
              // stopPropagation 会阻断容器 onDrop，需主动通知容器复位拖拽蒙版。
              handlers.current.onDropHandled?.();
              return true;
            },
          }),
        ],
      }),
    });
    view.current = current;
    handleRef.current = {
      focus: () => current.focus(),
      insertAt: (pos, text) =>
        current.dispatch({
          changes: { from: pos, to: pos, insert: text },
          selection: { anchor: pos + text.length },
          scrollIntoView: true,
        }),
      replaceRange: (from, to, text) =>
        current.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          scrollIntoView: true,
        }),
      selectionStart: () => current.state.selection.main.head,
    };
    return () => {
      handleRef.current = null;
      view.current = null;
      current.destroy();
    };
    // 视图只装配一次；外部值经下方 effect 单向同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    syncValue();
  }, [value]);
  return <div className={className} ref={host} />;
}
