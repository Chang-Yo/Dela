// 回复编辑器在笔记即时渲染之上补的水源写法：[quote] 块渲染成与阅读页一致的引用卡片，
// 光标进入块内即回到原文。
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

const OPEN = /^\[quote(?:="([^"]*)")?\]\s*$/;
const CLOSE = /^\[\/quote\]\s*$/;

class QuoteHeadWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: QuoteHeadWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const head = document.createElement('span');
    head.className = 'cm-sy-quote-label';
    head.textContent = this.label;
    return head;
  }
}

/** `alice, post:3, topic:9` → `@alice · 第 3 楼`；无署名的 [quote] 显示「引用」。 */
function quoteLabel(attribute: string | undefined): string {
  if (!attribute) return '引用';
  const [user, ...rest] = attribute.split(',').map((part) => part.trim());
  const post = rest.find((part) => part.startsWith('post:'))?.slice('post:'.length);
  return [user ? `@${user}` : '引用', post ? `第 ${post} 楼` : ''].filter(Boolean).join(' · ');
}

const lineClass = (className: string) => Decoration.line({ class: className });
const headLine = lineClass('cm-sy-quote cm-sy-quote-head');
const bodyLine = lineClass('cm-sy-quote');
const tailLine = lineClass('cm-sy-quote cm-sy-quote-tail');
const hidden = Decoration.replace({});

function quoteDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = state;
  for (let n = 1; n <= doc.lines; n += 1) {
    const open = OPEN.exec(doc.line(n).text);
    if (!open) continue;
    let close = n + 1;
    while (close <= doc.lines && !CLOSE.test(doc.line(close).text)) close += 1;
    if (close > doc.lines) break;
    const editing = state.selection.ranges.some(
      (range) => doc.lineAt(range.to).number >= n && doc.lineAt(range.from).number <= close,
    );
    for (let at = n; at <= close; at += 1) {
      const current = doc.line(at);
      builder.add(
        current.from,
        current.from,
        at === n ? headLine : at === close ? tailLine : bodyLine,
      );
      if (editing || (at !== n && at !== close)) continue;
      builder.add(
        current.from,
        current.to,
        at === n
          ? Decoration.replace({ widget: new QuoteHeadWidget(quoteLabel(open[1])) })
          : hidden,
      );
    }
    n = close;
  }
  return builder.finish();
}

const quotePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = quoteDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet)
        this.decorations = quoteDecorations(update.state);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// 色值引用 beautiful-ui 的基础变量（--line/--inset/--ink-3），与阅读页 aside.quote 同一套层次。
const theme = EditorView.theme({
  '.cm-sy-quote': {
    borderInline: '1px solid var(--line)',
    paddingInline: '0.75rem',
  },
  '.cm-sy-quote-head': {
    borderTop: '1px solid var(--line)',
    borderRadius: '0.5rem 0.5rem 0 0',
    backgroundColor: 'var(--inset)',
    color: 'var(--ink-3)',
    fontSize: '0.86em',
    paddingTop: '0.125rem',
  },
  '.cm-sy-quote-tail': {
    borderBottom: '1px solid var(--line)',
    borderRadius: '0 0 0.5rem 0.5rem',
    color: 'var(--ink-3)',
    paddingBottom: '0.125rem',
  },
  '.cm-sy-quote-label': { fontWeight: '500' },
});

export function shuiyuanReplyDecorations(): Extension {
  return [quotePlugin, theme];
}
