import { useEffect, useRef, type RefObject } from 'react';
import {
  defaultKeymap,
  history,
  historyKeymap,
  insertNewlineAndIndent,
} from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { cn } from '../../lib/utils';
import { codeHighlightStyle, markdownHighlightStyle } from '../../lib/syntax-highlight';
import { openLightbox } from '../../components/ui/lightbox';
import { matchChatImageTokens } from '../../../shared/chat-input';
import { getChatMediaPreview } from './media';
import type { ChatReference } from './drafts';
import { matchReferenceTokens } from './reference-tokens';

/** 容器注入的菜单键盘协议：返回 True 表示已消费该按键。 */
type ComposerMenuApi = {
  onKey: (key: 'down' | 'up' | 'select' | 'close') => boolean;
};

export type ComposerEditorHandle = {
  focus: () => void;
  /** 插入文本并把光标移到片段之后（内联图片 token 用）。 */
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
      image.className = 'cursor-zoom-in';
      image.addEventListener('click', () => openLightbox(preview, this.name));
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

// @ 引用 token：文档文本就是「@相对路径」，这里只负责把它画出来——@ 与目录前缀折叠成
// 一个文件图标，只留文件名可见（悬停图标或文件名可看完整路径），并经 atomicRanges 让
// 光标/退格把整段路径当作一个整体。
const setReferenceOptions = StateEffect.define<ChatReference[]>();
const referenceField = StateField.define<ChatReference[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setReferenceOptions)) return effect.value;
    return value;
  },
});

// 文件图标（lucide file-text 同形）：widget 里直接建 DOM，不经 React。
const FILE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

class ReferenceIconWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }
  eq(other: ReferenceIconWidget) {
    return other.title === this.title;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'dela-ref-icon';
    span.setAttribute('aria-hidden', 'true');
    span.title = this.title;
    span.innerHTML = FILE_ICON_SVG;
    return span;
  }
}

function referenceDecorations(view: EditorView): DecorationSet {
  const options = view.state.field(referenceField, false) ?? [];
  const builder = new RangeSetBuilder<Decoration>();
  for (const token of matchReferenceTokens(view.state.doc.toString(), options)) {
    const { start, end, ref } = token;
    // 文本里仍是完整「@路径」，解析不受显示折叠影响。
    const split = ref.title.lastIndexOf('/');
    const nameStart = start + 1 + (split < 0 ? 0 : split + 1);
    builder.add(
      start,
      nameStart,
      Decoration.replace({ widget: new ReferenceIconWidget(ref.title) }),
    );
    builder.add(
      nameStart,
      end,
      Decoration.mark({ attributes: { title: ref.title }, class: 'cm-ref-name' }),
    );
  }
  return builder.finish();
}

const referencePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = referenceDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setReferenceOptions)),
        )
      )
        this.decorations = referenceDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

// 编辑区内边距：.cm-scroller 与占位符覆盖层共用，避免两处漂移。rem 随主题字号缩放。
const SCROLLER_PADDING = { x: '1rem', top: '0.875rem' };

const composerTheme = EditorView.theme({
  '&': { fontSize: '0.875rem', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.65',
    overflowY: 'auto',
    // 高度封顶：绝对 224px + 相对 38vh 双上限，避免满高编辑器把消息流挤没。
    maxHeight: 'min(14rem, 38vh)',
    padding: `${SCROLLER_PADDING.top} ${SCROLLER_PADDING.x} 0.375rem`,
  },
  // CM 默认给 .cm-content 上下 4px、.cm-line 左 6px 右 2px 的内边距，会让光标/正文
  // 相对自绘占位符整体偏移（下 4px、右 6px），统一归零，正文与占位符共用同一原点。
  '.cm-content': { caretColor: 'inherit', padding: '0' },
  '.cm-line': { padding: '0' },
  '.dela-chat-image': {
    position: 'relative',
    display: 'inline-flex',
    verticalAlign: 'bottom',
    margin: '0.125rem 0',
  },
  '.dela-chat-image img': {
    display: 'block',
    maxHeight: '4.75rem',
    maxWidth: '11.25rem',
    // 与消息流内联图片同档圆角（rounded-xl），发送前后不跳变。
    borderRadius: 'var(--radius-xl)',
    border: '1px solid var(--color-line)',
  },
  '.dela-chat-image-fallback': {
    display: 'inline-block',
    maxWidth: '10rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '0.25rem 0.625rem',
    borderRadius: 'var(--radius-control)',
    border: '1px dashed var(--color-line)',
    color: 'var(--color-ink-3)',
    fontSize: '0.75rem',
  },
  '.dela-chat-image button': {
    position: 'absolute',
    top: '-0.4375rem',
    right: '-0.4375rem',
    display: 'grid',
    placeItems: 'center',
    width: '1rem',
    height: '1rem',
    borderRadius: '9999px',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-line)',
    color: 'var(--color-ink-3)',
    fontFamily: 'inherit',
    fontSize: '0.6875rem',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.dela-chat-image button:hover': { color: 'var(--color-ink)' },
  '.cm-ref-name': { color: 'var(--cal-blue-text)', fontWeight: 600 },
  '.dela-ref-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    marginRight: '0.125rem',
    color: 'var(--color-ink-2)',
    verticalAlign: '-0.125em',
  },
  '.dela-ref-icon svg': { width: '1em', height: '1em' },
});

const heroTheme = EditorView.theme({
  '.cm-content': { minHeight: '4rem' },
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
  referenceOptions,
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
  /** @ 引用候选：文本中命中的 @路径会渲染成引用 token。 */
  referenceOptions: ChatReference[];
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
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.lineWrapping,
          referenceField,
          imagePlugin,
          referencePlugin,
          EditorView.atomicRanges.of((target) => {
            const image = target.plugin(imagePlugin)?.decorations ?? Decoration.none;
            const refs = target.plugin(referencePlugin)?.decorations ?? Decoration.none;
            if (image === Decoration.none) return refs;
            if (refs === Decoration.none) return image;
            const ranges: Range<Decoration>[] = [];
            for (let it = image.iter(); it.value; it.next())
              ranges.push({ from: it.from, to: it.to, value: it.value });
            for (let it = refs.iter(); it.value; it.next())
              ranges.push({ from: it.from, to: it.to, value: it.value });
            return Decoration.set(ranges, true);
          }),
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
          syntaxHighlighting(codeHighlightStyle),
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
  // 已知引用候选变化（镜像/远端索引载入）时同步进 CM state，重算 token 装饰。
  useEffect(() => {
    view.current?.dispatch({ effects: setReferenceOptions.of(referenceOptions) });
  }, [referenceOptions]);
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
          className="pointer-events-none absolute select-none break-words text-ink-3"
          style={{
            fontSize: '0.875rem',
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
