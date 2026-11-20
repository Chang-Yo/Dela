import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';
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
import { cn } from '../../../ui/lib/cn';
import { codeHighlightStyle, markdownHighlightStyle } from '../../preview/view';
import { openLightbox } from '../../../ui/lightbox';
import { matchChatImageTokens } from '../../../core/protocol/chat-input';
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

// @ 引用 token：文档文本就是「@相对路径」，这里只负责画出来——折叠成文件图标加文件名，
// 并经 atomicRanges 让光标/退格把整段路径当整体。
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

const SESSION_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

class ReferenceIconWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly session = false,
  ) {
    super();
  }
  eq(other: ReferenceIconWidget) {
    return other.title === this.title && other.session === this.session;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'dela-ref-icon';
    span.setAttribute('aria-hidden', 'true');
    span.title = this.title;
    span.innerHTML = this.session ? SESSION_ICON_SVG : FILE_ICON_SVG;
    return span;
  }
}

function referenceDecorations(view: EditorView): DecorationSet {
  const options = view.state.field(referenceField, false) ?? [];
  const builder = new RangeSetBuilder<Decoration>();
  for (const token of matchReferenceTokens(view.state.doc.toString(), options)) {
    const { start, end, ref } = token;
    // 文本里仍是完整「@路径」，解析不受显示折叠影响；会话标题里的 / 不是目录，只折叠 #。
    const split = ref.session ? -1 : ref.title.lastIndexOf('/');
    const nameStart = start + 1 + (split < 0 ? 0 : split + 1);
    builder.add(
      start,
      nameStart,
      Decoration.replace({ widget: new ReferenceIconWidget(ref.title, ref.session) }),
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
    maxHeight: 'min(14rem, 38vh)',
    padding: `${SCROLLER_PADDING.top} ${SCROLLER_PADDING.x} 0.375rem`,
  },
  // CM 默认的内边距会让光标/正文相对自绘占位符偏移，统一归零，共用同一原点。
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
    borderRadius: 'var(--radius-window)',
    border: '1px solid var(--line)',
  },
  '.dela-chat-image-fallback': {
    display: 'inline-block',
    maxWidth: '10rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '0.25rem 0.625rem',
    borderRadius: 'var(--radius-control)',
    border: '1px dashed var(--line)',
    color: 'var(--ink-3)',
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
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--line)',
    color: 'var(--ink-3)',
    fontFamily: 'inherit',
    fontSize: '0.6875rem',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.dela-chat-image button:hover': { color: 'var(--ink)' },
  '.cm-ref-name': { color: 'var(--accent-ink)', fontWeight: 600 },
  '.dela-ref-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    marginRight: '0.125rem',
    color: 'var(--ink-2)',
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
  menuAria?: { open: boolean; listId: string; activeId: string | null };
  placeholderText: string;
  hero?: boolean;
  handleRef: RefObject<ComposerEditorHandle | null>;
  className?: string;
  referenceOptions: ChatReference[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const emitChange = useEffectEvent((text: string) => onChange(text));
  const emitSend = useEffectEvent(() => onSend());
  const emitCaret = useEffectEvent((text: string, caret: number) => onCaret(text, caret));
  const emitFiles = useEffectEvent((files: File[], pos: number) => onFiles(files, pos));
  const emitDropHandled = useEffectEvent(() => onDropHandled?.());
  const pressMenuKey = useEffectEvent((key: 'down' | 'up' | 'select' | 'close') => menu.onKey(key));

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
              { key: 'ArrowDown', run: () => pressMenuKey('down') },
              { key: 'ArrowUp', run: () => pressMenuKey('up') },
              { key: 'Escape', run: () => pressMenuKey('close') },
              { key: 'Tab', run: () => pressMenuKey('select') },
              {
                key: 'Enter',
                run: (target) => {
                  // IME 组文中的 Enter 是候选词操作，不发送。
                  if (target.compositionStarted) return false;
                  if (pressMenuKey('select')) return true;
                  emitSend();
                  return true;
                },
              },
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
            if (update.docChanged) emitChange(update.state.doc.toString());
            if (update.docChanged || update.selectionSet)
              emitCaret(update.state.doc.toString(), update.state.selection.main.head);
          }),
          EditorView.domEventHandlers({
            paste: (event, target) => {
              const files = filesFromTransfer(event.clipboardData);
              if (!files.length) return false;
              event.preventDefault();
              emitFiles(files, target.state.selection.main.head);
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
              emitFiles(files, pos);
              // stopPropagation 会阻断容器 onDrop，需主动通知容器复位拖拽蒙版。
              emitDropHandled();
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
  }, []);
  // 外部值同步（发送失败恢复等）：IME 组文期间全量替换会打断输入法，此时丢弃外部变更，
  // 以用户输入为准（后续 onChange 会把草稿收敛回编辑器内容）。
  useEffect(() => {
    const current = view.current;
    if (!current || value === current.state.doc.toString() || current.compositionStarted) return;
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({ effects: setReferenceOptions.of(referenceOptions) });
  }, [referenceOptions]);
  // combobox 语义落在 CM 内容元素：属性 CM 不管理，命令式同步；
  // 拆成原始值做依赖，打字时不重复写 DOM。
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
  // 占位符用自绘覆盖层：CM 内置 placeholder 的行内 widget 会让空文档的光标视觉上落在文字右侧，
  // 与实际插入点不一致。
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
