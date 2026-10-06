import { useEffect, useRef, type RefObject } from 'react';
import {
  defaultKeymap,
  history,
  historyKeymap,
  insertNewlineAndIndent,
} from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { cn } from '../../lib/utils';
import { matchChatImageTokens } from '../../../shared/chat-input';
import { getChatMediaPreview } from './media';

/* 语法高亮配色（GitHub Light/Dark，Primer prettylights）：色值定义在
   styles/globals.css 的 --syntax-*，跟随系统明暗主题，无需在此区分。
   与 features/projects/MarkdownEditor 的同名定义内容一致——content 域互不 import
   （structure.md §3.3）的边界下各持一份，统一落点（renderer/lib）由 3B 接线时定。 */
const markdownHighlightStyle = HighlightStyle.define([
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

/** 容器注入的菜单键盘协议：返回 True 表示已消费该按键。 */
type ComposerMenuApi = {
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

// 编辑区内边距：.cm-scroller 与占位符覆盖层共用，避免两处漂移。
const SCROLLER_PADDING = { x: 16, top: 14 };

const composerTheme = EditorView.theme({
  '&': { fontSize: 'calc(14px * var(--font-scale, 1))', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.65',
    overflowY: 'auto',
    // 高度按视口封顶：440px 最小窗口下 224px 满高编辑器会把消息流挤没。
    maxHeight: 'min(224px, 38vh)',
    padding: `${SCROLLER_PADDING.top}px ${SCROLLER_PADDING.x}px 6px`,
  },
  // CM 默认给 .cm-content 上下 4px、.cm-line 左 6px 右 2px 的内边距，会让光标/正文
  // 相对自绘占位符整体偏移（下 4px、右 6px），统一归零，正文与占位符共用同一原点。
  '.cm-content': { caretColor: 'inherit', padding: '0' },
  '.cm-line': { padding: '0' },
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
    // 与消息流内联图片同档圆角（rounded-xl），发送前后不跳变。
    borderRadius: 'var(--radius-xl)',
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
  menuAria,
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
  /** @/斜杠候选菜单的 combobox 状态：展开与当前高亮同步到编辑器内容元素，读屏可感知。 */
  menuAria?: { open: boolean; listId: string; activeId: string | null };
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
  // combobox 语义落在 CM 内容元素（编辑焦点所在）：role 与 aria-controls 常驻，
  // expanded/activedescendant 随候选菜单开合与高亮移动（对照 GlobalSearchDialog 输入框）。
  // 这几个属性 CM 不管理，直接命令式同步；拆出原始值做依赖，打字时不重复写 DOM。
  const menuAriaOpen = menuAria?.open ?? false;
  const menuAriaListId = menuAria?.listId ?? '';
  const menuAriaActiveId = menuAria?.activeId ?? null;
  useEffect(() => {
    const content = view.current?.contentDOM;
    if (!content) return;
    content.setAttribute('role', 'combobox');
    content.setAttribute('aria-expanded', String(menuAriaOpen));
    content.setAttribute('aria-controls', menuAriaListId);
    if (menuAriaOpen && menuAriaActiveId)
      content.setAttribute('aria-activedescendant', menuAriaActiveId);
    else content.removeAttribute('aria-activedescendant');
  }, [menuAriaActiveId, menuAriaListId, menuAriaOpen]);
  // 占位符用自绘覆盖层而不是 CM 内置 placeholder：内置实现把占位文本作为行内原子
  // widget 插在光标同位（side 1），空文档点击时光标视觉上落在占位文字右侧，与实际
  // 插入点（文档开头）不一致；覆盖层不参与布局，光标始终停在行首。
  const empty = value.length === 0;
  return (
    <div className={cn('relative', className)} ref={host}>
      {empty && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute select-none break-words text-muted-foreground"
          style={{
            fontSize: 'calc(14px * var(--font-scale, 1))',
            left: SCROLLER_PADDING.x,
            lineHeight: '1.65',
            right: SCROLLER_PADDING.x,
            top: SCROLLER_PADDING.top,
          }}
        >
          {placeholderText}
        </div>
      )}
    </div>
  );
}
