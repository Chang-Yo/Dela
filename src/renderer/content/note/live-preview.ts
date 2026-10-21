// Markdown 即时渲染（Obsidian 式 live preview）：文档始终是磁盘上的原文，这里只加装饰——
// 光标不在的行隐藏标记符号、按语法树给标题/强调/代码/引用上样式，图片在行下方显示。
// 不做所见即所得的往返序列化：用户不改的字节一个都不会变（列表符号、空行、转义、换行符）。
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/** 光标所在行（含多选区）保持原文，便于编辑标记本身。 */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let line = from; line <= to; line += 1) lines.add(line);
  }
  return lines;
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const image = document.createElement('img');
    image.src = this.src;
    image.alt = this.alt;
    image.loading = 'lazy';
    image.className = 'cm-md-image';
    return image;
  }
  ignoreEvent() {
    return false;
  }
}

const hidden = Decoration.replace({});
const mark = (className: string) => Decoration.mark({ class: className });
const line = (className: string) => Decoration.line({ class: className });

const headingLine = [1, 2, 3, 4, 5, 6].map((level) => line(`cm-md-h cm-md-h${level}`));
const marks = {
  StrongEmphasis: mark('cm-md-strong'),
  Emphasis: mark('cm-md-em'),
  Strikethrough: mark('cm-md-strike'),
  InlineCode: mark('cm-md-code'),
  Link: mark('cm-md-link'),
} as const;
const quoteLine = line('cm-md-quote');
const codeLine = line('cm-md-codeblock');

// 光标离开后隐藏的标记符号；URL 与链接括号随 Link 一起隐藏，只留可读文本。
const hiddenMarks = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'LinkMark',
  'URL',
  'LinkTitle',
  'QuoteMark',
]);

type Range = { from: number; to: number; value: Decoration };

function build(view: EditorView, resolveImage: (src: string) => string): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const ranges: Range[] = [];
  const lineOf = (pos: number) => state.doc.lineAt(pos);
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const startLine = lineOf(node.from);
        const editing = active.has(startLine.number);
        const heading = /^ATXHeading([1-6])$/.exec(name);
        if (heading) {
          ranges.push({
            from: startLine.from,
            to: startLine.from,
            value: headingLine[Number(heading[1]) - 1]!,
          });
          return;
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          for (let n = startLine.number; n <= lineOf(node.to).number; n += 1) {
            const at = state.doc.line(n).from;
            ranges.push({ from: at, to: at, value: codeLine });
          }
          // 代码块内的标记（围栏）照原样显示：编辑语言名与内容都需要看见它。
          return false;
        }
        if (name === 'Blockquote') {
          for (let n = startLine.number; n <= lineOf(node.to).number; n += 1) {
            const at = state.doc.line(n).from;
            ranges.push({ from: at, to: at, value: quoteLine });
          }
          return;
        }
        if (name === 'Image') {
          const text = state.sliceDoc(node.from, node.to);
          const match = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(text);
          if (match) {
            const end = lineOf(node.to).to;
            ranges.push({
              from: end,
              to: end,
              value: Decoration.widget({
                widget: new ImageWidget(resolveImage(match[2]!), match[1]!),
                side: 1,
              }),
            });
          }
          return false;
        }
        const style = marks[name as keyof typeof marks];
        if (style && node.to > node.from)
          ranges.push({ from: node.from, to: node.to, value: style });
        if (!editing && hiddenMarks.has(name) && node.to > node.from) {
          // 标题标记连同其后的空格一起隐藏，否则标题首字前留一个空位。
          const after =
            name === 'HeaderMark' && state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0;
          ranges.push({ from: node.from, to: node.to + after, value: hidden });
        }
      },
    });
  }
  // RangeSetBuilder 要求按起点排序；同一起点 line 装饰须先于 mark/replace。
  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, range.value);
  return builder.finish();
}

const theme = EditorView.theme({
  '.cm-md-h': { fontWeight: '600', color: 'var(--color-foreground)' },
  '.cm-md-h1': { fontSize: '1.6em', lineHeight: '1.4' },
  '.cm-md-h2': { fontSize: '1.35em', lineHeight: '1.4' },
  '.cm-md-h3': { fontSize: '1.15em' },
  '.cm-md-strong': { fontWeight: '600' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    backgroundColor: 'var(--color-muted)',
    borderRadius: '4px',
    padding: '0 0.2em',
  },
  '.cm-md-link': { color: 'var(--syntax-string)', textDecoration: 'underline' },
  '.cm-md-quote': {
    borderLeft: '2px solid var(--color-border)',
    paddingLeft: '0.75rem',
    color: 'var(--color-muted-foreground)',
  },
  '.cm-md-codeblock': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    backgroundColor: 'var(--color-muted)',
  },
  '.cm-md-image': { display: 'block', maxWidth: '100%', margin: '0.5rem 0', borderRadius: '6px' },
});

/** 粘贴或拖入图片：交给 save 落盘（同目录 assets/），在光标/落点插入相对路径引用。
 *  只插入用户这一次的引用文本，不碰文档其他部分。 */
export function markdownImageInsert(
  save: (file: File) => Promise<string>,
  onError: (error: unknown) => void,
): Extension {
  const insert = (view: EditorView, files: File[], at: number) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return false;
    void (async () => {
      let pos = at;
      for (const file of images) {
        try {
          const ref = await save(file);
          // 空格与括号会截断 `(...)` 链接目标：编码写入，读取方经 decodeAssetPath 还原。
          const target = encodeURI(ref).replace(/\(/g, '%28').replace(/\)/g, '%29');
          const text = `![${file.name.replace(/[[\]\n]/g, ' ')}](${target})`;
          view.dispatch({
            changes: { from: pos, insert: text },
            selection: { anchor: pos + text.length },
          });
          pos += text.length;
        } catch (error) {
          onError(error);
        }
      }
    })();
    return true;
  };
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      if (!insert(view, [...(event.clipboardData?.files ?? [])], view.state.selection.main.head))
        return false;
      event.preventDefault();
      return true;
    },
    drop: (event, view) => {
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (
        !insert(view, [...(event.dataTransfer?.files ?? [])], at ?? view.state.selection.main.head)
      )
        return false;
      event.preventDefault();
      return true;
    },
  });
}

/** resolveImage 把正文里的相对图片地址换成受限资源协议地址（只影响显示，不改正文）。 */
export function markdownLivePreview(resolveImage: (src: string) => string): Extension {
  return [
    theme,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view, resolveImage);
        }
        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
            syntaxTree(update.startState) !== syntaxTree(update.state)
          )
            this.decorations = build(update.view, resolveImage);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
