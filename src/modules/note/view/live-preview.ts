// Markdown 即时渲染（Obsidian 式）：文档始终是磁盘上的原文，只加装饰，用户不改的字节一个都不会变；
// 光标进入公式、mermaid、表格即回到原文。表格要求调用方以 markdownLanguage 为 base 解析。
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { mermaidConfig, renderMermaid } from '../../preview/view';
import { findMath, renderMath } from './math';

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
    readonly block = false,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.block === this.block;
  }
  toDOM() {
    const image = document.createElement('img');
    image.src = this.src;
    image.alt = this.alt;
    image.loading = 'lazy';
    image.className = 'cm-md-image';
    if (!this.block) return image;
    // 块级挂件的外边距不计入高度测量，外包一层 flow-root 收进盒子里。
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-md-image-block';
    wrapper.append(image);
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM() {
    const element = document.createElement(this.display ? 'div' : 'span');
    element.className = this.display ? 'cm-md-math-block' : 'cm-md-math';
    element.innerHTML = renderMath(this.tex, this.display);
    return element;
  }
  ignoreEvent() {
    return false;
  }
}

class MermaidWidget extends WidgetType {
  constructor(readonly chart: string) {
    super();
  }
  eq(other: MermaidWidget) {
    return other.chart === this.chart;
  }
  toDOM() {
    const element = document.createElement('div');
    element.className = 'cm-md-mermaid';
    element.textContent = '正在渲染图表…';
    renderMermaid(`dela-note-mermaid-${crypto.randomUUID()}`, this.chart, mermaidConfig()).then(
      ({ svg }) => {
        element.innerHTML = svg;
      },
      (error: unknown) => {
        element.classList.add('cm-md-mermaid-error');
        element.textContent = `mermaid 语法错误：${error instanceof Error ? error.message : String(error)}`;
      },
    );
    return element;
  }
  get estimatedHeight() {
    return 160;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  constructor(readonly glyph: string) {
    super();
  }
  eq(other: BulletWidget) {
    return other.glyph === this.glyph;
  }
  toDOM() {
    const element = document.createElement('span');
    element.className = 'cm-md-bullet';
    element.textContent = this.glyph;
    return element;
  }
  ignoreEvent() {
    return false;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerOffset: number,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.markerOffset === this.markerOffset;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-md-task';
    box.checked = this.checked;
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      const at = view.posAtDOM(box) + this.markerOffset + 1;
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.checked ? ' ' : 'x' } });
    });
    // 勾选状态只由正文决定：浏览器自己的切换一律撤销。
    box.addEventListener('click', (event) => event.preventDefault());
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

type Segment = { text: string; className: string; math?: boolean };

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly prefix: string,
    readonly align: string[],
    readonly rows: Segment[][][],
  ) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const wrapper = document.createElement('div');
    // 引用里的表格沿用引用的左边线；列表里的表格按原文缩进对齐。
    wrapper.className = this.prefix.includes('>') ? 'cm-md-table cm-md-quote' : 'cm-md-table';
    if (!this.prefix.includes('>')) wrapper.style.marginLeft = `${this.prefix.length}ch`;
    const table = wrapper.appendChild(document.createElement('table'));
    const head = table.createTHead();
    const body = table.createTBody();
    this.rows.forEach((row, index) => {
      const tr = (index ? body : head).insertRow();
      row.forEach((segments, column) => {
        const cell = tr.appendChild(document.createElement(index ? 'td' : 'th'));
        cell.style.textAlign = this.align[column]!;
        for (const { text, className, math } of segments) {
          const span = cell.appendChild(document.createElement('span'));
          if (math) {
            span.className = 'cm-md-math';
            span.innerHTML = renderMath(text, false);
          } else {
            span.className = className;
            span.textContent = text;
          }
        }
      });
    });
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

const hidden = Decoration.replace({});
const mark = (className: string) => Decoration.mark({ class: className });
const line = (className: string) => Decoration.line({ class: className });

const headingLine = [1, 2, 3, 4, 5, 6].map((level) => line(`cm-md-h cm-md-h${level}`));
const markClasses: Record<string, string> = {
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-em',
  Strikethrough: 'cm-md-strike',
  InlineCode: 'cm-md-code',
  Link: 'cm-md-link',
  URL: 'cm-md-link',
};
const marks = Object.fromEntries(
  Object.entries(markClasses).map(([name, className]) => [name, mark(className)]),
);
const quoteLine = line('cm-md-quote');
const codeLine = line('cm-md-codeblock');
const hrLine = line('cm-md-hr');
const imageSource = mark('cm-md-image-src');
const bullets = ['•', '◦', '▪'].map((glyph) =>
  Decoration.replace({ widget: new BulletWidget(glyph) }),
);

const hiddenMarks = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'LinkMark',
  'LinkTitle',
  'QuoteMark',
]);

type Range = { from: number; to: number; value: Decoration };

const codeNodes = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText']);

function inCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (!codeNodes.has(node.name)) {
    if (!node.parent) return false;
    node = node.parent;
  }
  return true;
}

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

function shouldHideMarkup(state: EditorState, node: SyntaxNode): boolean {
  if (node.name !== 'URL') return hiddenMarks.has(node.name);
  if (node.parent?.name === 'LinkReference') return true;
  const before = node.prevSibling;
  return (
    node.parent?.name === 'Link' &&
    before?.name === 'LinkMark' &&
    state.sliceDoc(before.from, before.to) === '('
  );
}

function cellSegments(state: EditorState, cell: SyntaxNode): Segment[] {
  const pieces: { from: number; to: number; className: string }[] = [];
  const walk = (node: SyntaxNode, className: string) => {
    let pos = node.from;
    const text = (from: number, to: number) => {
      if (to > from) pieces.push({ from, to, className });
    };
    for (let child = node.firstChild; child; child = child.nextSibling) {
      text(pos, child.from);
      if (child.name === 'Escape') text(child.from + 1, child.to);
      else if (!shouldHideMarkup(state, child))
        walk(child, [className, markClasses[child.name]].filter(Boolean).join(' '));
      pos = child.to;
    }
    text(pos, node.to);
  };
  walk(cell, '');
  const maths = findMath(state.sliceDoc(cell.from, cell.to), cell.from, (pos) =>
    inCode(state, pos),
  );
  const segments: Segment[] = [];
  for (const piece of pieces) {
    let from = piece.from;
    for (const math of maths) {
      if (math.to <= from || math.from >= piece.to) continue;
      if (math.from > from)
        segments.push({ text: state.sliceDoc(from, math.from), className: piece.className });
      if (math.from >= piece.from) segments.push({ text: math.tex, className: '', math: true });
      from = math.to;
    }
    if (piece.to > from)
      segments.push({ text: state.sliceDoc(from, piece.to), className: piece.className });
  }
  return segments;
}

function tableWidget(state: EditorState, table: SyntaxNode, from: number): TableWidget {
  let align: string[] = [];
  const rows: Segment[][][] = [];
  for (let row = table.firstChild; row; row = row.nextSibling) {
    if (row.name === 'TableDelimiter') {
      align = state
        .sliceDoc(row.from, row.to)
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((spec) => {
          const left = spec.trim().startsWith(':');
          const right = spec.trim().endsWith(':');
          return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
        });
      continue;
    }
    if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue;
    const cells: Segment[][] = [];
    let column = 0;
    for (let child = row.firstChild; child; child = child.nextSibling) {
      if (child.name === 'TableCell') cells[column] = cellSegments(state, child);
      else if (child.from > row.from) column += 1;
    }
    rows.push(cells);
  }
  return new TableWidget(
    state.sliceDoc(from, table.to),
    state.sliceDoc(from, table.from),
    align,
    rows.map((cells) => align.map((_, column) => cells[column] ?? [])),
  );
}

/** 返回 null 表示不按图片显示（如音视频附件），保持原文。 */
export type ImageResolver = (src: string, alt: string) => string | null;

function imageWidget(
  state: EditorState,
  node: SyntaxNode,
  resolveImage: ImageResolver,
  block = false,
): ImageWidget | null {
  const match = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(state.sliceDoc(node.from, node.to));
  if (!match) return null;
  const src = resolveImage(match[2]!, match[1]!);
  return src === null ? null : new ImageWidget(src, match[1]!, block);
}

function imageLine(state: EditorState, node: SyntaxNode) {
  const line = state.doc.lineAt(node.from);
  const whole =
    node.to <= line.to &&
    /^[ \t]*$/.test(state.sliceDoc(line.from, node.from)) &&
    /^\s*$/.test(state.sliceDoc(node.to, line.to));
  return whole ? line : null;
}

/** 块装饰只能来自 StateField，不能来自 ViewPlugin。 */
function blockWidgets(state: EditorState, resolveImage: ImageResolver): DecorationSet {
  const ranges: Range[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Image') {
        const line = imageLine(state, node.node);
        const widget =
          line && !touches(state, line.from, line.to)
            ? imageWidget(state, node.node, resolveImage, true)
            : null;
        if (line && widget)
          ranges.push({
            from: line.from,
            to: line.to,
            value: Decoration.replace({ widget, block: true }),
          });
        return false;
      }
      if (node.name === 'Table') {
        // 块级替换必须覆盖整行；行首还有列表符号等内容时放不下，保持原文。
        const from = state.doc.lineAt(node.from).from;
        const whole =
          /^[ \t>]*$/.test(state.sliceDoc(from, node.from)) &&
          state.doc.lineAt(node.to).to === node.to;
        if (whole && !touches(state, from, node.to))
          ranges.push({
            from,
            to: node.to,
            value: Decoration.replace({
              widget: tableWidget(state, node.node, from),
              block: true,
            }),
          });
        return false;
      }
      if (node.name !== 'FencedCode') return;
      const info = node.node.getChild('CodeInfo');
      if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== 'mermaid')
        return false;
      const body = node.node.getChild('CodeText');
      if (!touches(state, node.from, node.to) && body)
        ranges.push({
          from: node.from,
          to: node.to,
          value: Decoration.replace({
            widget: new MermaidWidget(state.sliceDoc(body.from, body.to)),
            block: true,
          }),
        });
      return false;
    },
  });
  for (const math of findMath(state.sliceDoc(), 0, (pos) => inCode(state, pos))) {
    if (!math.display || touches(state, math.from, math.to)) continue;
    // 块级替换必须覆盖整行：$$ 前后还有文字时退回行内显示。
    const first = state.doc.lineAt(math.from);
    const last = state.doc.lineAt(math.to);
    const whole = first.from === math.from && last.to === math.to;
    ranges.push({
      from: math.from,
      to: math.to,
      value: Decoration.replace({ widget: new MathWidget(math.tex, true), block: whole }),
    });
  }
  ranges.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  let end = -1;
  for (const range of ranges) {
    if (range.from < end) continue;
    builder.add(range.from, range.to, range.value);
    end = range.to;
  }
  return builder.finish();
}

const blockField = (resolveImage: ImageResolver) =>
  StateField.define<DecorationSet>({
    create: (state) => blockWidgets(state, resolveImage),
    update: (value, transaction) =>
      transaction.docChanged ||
      transaction.selection ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
        ? blockWidgets(transaction.state, resolveImage)
        : value,
    provide: (field) => EditorView.decorations.from(field),
  });

function build(view: EditorView, resolveImage: ImageResolver): DecorationSet {
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
        const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
        if (heading) {
          ranges.push({
            from: startLine.from,
            to: startLine.from,
            value: headingLine[Number(heading[1]) - 1]!,
          });
          return;
        }
        if (name === 'HorizontalRule') {
          if (!editing)
            ranges.push(
              { from: startLine.from, to: startLine.from, value: hrLine },
              { from: node.from, to: node.to, value: hidden },
            );
          return false;
        }
        if (name === 'ListMark' && !editing && node.node.parent?.parent?.name === 'BulletList') {
          if (node.node.nextSibling?.name === 'Task') return;
          let depth = 0;
          for (let list = node.node.parent.parent.parent; list; list = list.parent)
            if (list.name === 'BulletList' || list.name === 'OrderedList') depth += 1;
          ranges.push({ from: node.from, to: node.to, value: bullets[depth % bullets.length]! });
          return;
        }
        if (name === 'TaskMarker' && !editing) {
          const item = node.node.parent!.parent!;
          const from = item.parent?.name === 'BulletList' ? item.from : node.from;
          const checked = state.sliceDoc(node.from + 1, node.from + 2).toLowerCase() === 'x';
          ranges.push({
            from,
            to: node.to,
            value: Decoration.replace({ widget: new TaskWidget(checked, node.from - from) }),
          });
          return;
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          for (let n = startLine.number; n <= lineOf(node.to).number; n += 1) {
            const at = state.doc.line(n).from;
            ranges.push({ from: at, to: at, value: codeLine });
          }
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
          // 独占一行且光标不在时由 blockWidgets 整行替换。
          const widget = imageWidget(state, node.node, resolveImage);
          if (!widget || (!editing && imageLine(state, node.node))) return false;
          const end = lineOf(node.to).to;
          ranges.push(
            { from: node.from, to: node.to, value: editing ? imageSource : hidden },
            { from: end, to: end, value: Decoration.widget({ widget, side: 1 }) },
          );
          return false;
        }
        const style = marks[name];
        if (style && node.to > node.from)
          ranges.push({ from: node.from, to: node.to, value: style });
        if (!editing && shouldHideMarkup(state, node.node) && node.to > node.from) {
          const after =
            name === 'HeaderMark' && state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0;
          ranges.push({ from: node.from, to: node.to + after, value: hidden });
        }
      },
    });
  }
  // 行内公式：光标不在其所在行时替换为渲染结果。块级公式在 blockWidgets 里处理。
  for (const { from, to } of view.visibleRanges) {
    const start = state.doc.lineAt(from).from;
    for (const math of findMath(state.sliceDoc(start, to), start, (pos) => inCode(state, pos))) {
      if (math.display || active.has(lineOf(math.from).number)) continue;
      ranges.push({
        from: math.from,
        to: math.to,
        value: Decoration.replace({ widget: new MathWidget(math.tex, false) }),
      });
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, range.value);
  return builder.finish();
}

// 只引用基础变量与一定会输出的 theme 变量：Tailwind v4 会裁掉未被工具类用到的 --color-*。
const theme = EditorView.theme({
  '.cm-md-h': { fontWeight: '600', color: 'var(--ink)' },
  '.cm-md-h1': { fontSize: '1.6em', lineHeight: '1.4' },
  '.cm-md-h2': { fontSize: '1.35em', lineHeight: '1.4' },
  '.cm-md-h3': { fontSize: '1.15em' },
  '.cm-md-strong': { fontWeight: '600' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': {
    fontFamily: 'var(--font-mono)',
    color: 'var(--syntax-operator)',
    backgroundColor: 'var(--syntax-bg)',
    borderRadius: 'var(--radius-chip)',
    padding: '0 0.2em',
  },
  '.cm-md-link': { color: 'var(--syntax-tag)', textDecoration: 'underline' },
  '.cm-md-quote': {
    borderLeft: '2px solid var(--line)',
    paddingLeft: 'calc(var(--spacing) * 3)',
    color: 'var(--ink-3)',
  },
  '.cm-md-codeblock': {
    fontFamily: 'var(--font-mono)',
    backgroundColor: 'var(--syntax-bg)',
    color: 'var(--syntax-fg)',
  },
  '.cm-md-hr': {
    backgroundImage: 'linear-gradient(var(--line-strong), var(--line-strong))',
    backgroundSize: '100% 2px',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  },
  '.cm-md-bullet': {
    display: 'inline-block',
    width: '1ch',
    textAlign: 'center',
    color: 'var(--ink-3)',
  },
  '.cm-md-task': {
    margin: '0 0.5ch 0 0',
    verticalAlign: 'middle',
    cursor: 'pointer',
    accentColor: 'var(--accent)',
  },
  '.cm-md-table': { overflowX: 'auto', paddingBlock: 'calc(var(--spacing) * 2)' },
  '.cm-md-table table': { borderCollapse: 'collapse' },
  '.cm-md-table th, .cm-md-table td': {
    border: '1px solid var(--line-strong)',
    padding: 'calc(var(--spacing) * 1) calc(var(--spacing) * 3)',
  },
  '.cm-md-table th': { fontWeight: '600', backgroundColor: 'var(--inset)' },
  '.cm-md-image-src': { color: 'var(--ink-3)', fontSize: '0.86em' },
  '.cm-md-image-block': { display: 'flow-root' },
  '.cm-md-image': {
    display: 'block',
    maxWidth: '100%',
    margin: 'calc(var(--spacing) * 2) 0',
    borderRadius: 'var(--radius-chip)',
  },
  '.cm-md-math-block': {
    padding: 'calc(var(--spacing) * 2) 0',
    overflowX: 'auto',
    textAlign: 'center',
  },
  '.cm-md-mermaid': {
    padding: 'calc(var(--spacing) * 2) 0',
    overflowX: 'auto',
    textAlign: 'center',
    color: 'var(--ink-3)',
  },
  '.cm-md-mermaid svg': { maxWidth: '100%', height: 'auto' },
  '.cm-md-mermaid-error': { color: 'var(--danger)', textAlign: 'left' },
});

/** 粘贴或拖入图片：交给 save 落盘，只在落点插入这一次的引用文本。 */
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

export function markdownLivePreview(resolveImage: ImageResolver): Extension {
  return [
    theme,
    blockField(resolveImage),
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
