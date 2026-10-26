// Markdown 即时渲染（Obsidian 式 live preview）：文档始终是磁盘上的原文，这里只加装饰——
// 光标不在的行隐藏标记符号、按语法树给标题/强调/代码/引用上样式，图片在行下方显示；
// 光标不在公式、mermaid 代码块或表格里时，原文替换成渲染结果，光标移进去即回到原文。
// 不做所见即所得的往返序列化：用户不改的字节一个都不会变（列表符号、空行、转义、换行符）。
// 表格等 GFM 语法要求调用方以 markdownLanguage 为 base 解析；代码 token 由调用方的 codeHighlightStyle 着色，
// 正文保持中性，不叠加 markdownHighlightStyle。
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
import { mermaidConfig, renderMermaid } from '../../lib/mermaid';
import { findMath, renderMath } from './math';

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
  // 点击公式交给编辑器定位光标：光标落进原文区间后公式回到可编辑的原文。
  ignoreEvent() {
    return false;
  }
}

let mermaidSeq = 0;

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
    renderMermaid(`dela-note-mermaid-${(mermaidSeq += 1)}`, this.chart, mermaidConfig()).then(
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

/** 任务列表复选框：点击只翻转 `[ ]`/`[x]` 里那一个字符，不移动光标。 */
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
    // 勾选状态只由正文决定：浏览器自己的切换一律撤销，正文改动后组件会重建。
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
};
const marks = Object.fromEntries(
  Object.entries(markClasses).map(([name, className]) => [name, mark(className)]),
);
const quoteLine = line('cm-md-quote');
const codeLine = line('cm-md-codeblock');
const hrLine = line('cm-md-hr');
// 嵌套列表逐层换符号。
const bullets = ['•', '◦', '▪'].map((glyph) =>
  Decoration.replace({ widget: new BulletWidget(glyph) }),
);

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

const codeNodes = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText']);

/** 位置落在行内代码或代码块里：公式扫描跳过它，`$` 在代码里只是字符。 */
function inCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (!codeNodes.has(node.name)) {
    if (!node.parent) return false;
    node = node.parent;
  }
  return true;
}

/** 选区是否碰到 [from, to]：碰到就显示原文。 */
function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** 单元格内的行内语法拆成带样式的文本段；标记符号与链接地址不显示，转义只留字符本身，
 *  行内公式整体换成一个公式段（公式里被误解析出的强调等标记一并吞掉）。 */
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
      else if (!hiddenMarks.has(child.name))
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

/** GFM 表格：对齐取自分隔行；空单元格没有 TableCell 节点，按竖线计列，多余列丢弃、缺列补空。
 *  引用里的表格节点夹着各行的 QuoteMark，只取表头、数据行与分隔行。 */
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

/** 跨行的块级渲染（$$ 公式、mermaid 代码块、表格）：块装饰只能来自 StateField，不能来自 ViewPlugin。 */
function blockWidgets(state: EditorState): DecorationSet {
  const ranges: Range[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        // 块级替换必须覆盖整行：引用、列表里的表格连同行首的 `> `/缩进一起替换；
        // 首行前面还有列表符号等其他内容时放不下，保持原文。
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
    // 块级替换必须覆盖整行：$$ 前后同一行还有别的文字时退回行内显示。
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
    if (range.from < end) continue; // 公式写在 mermaid 块里等重叠情况：先到者得。
    builder.add(range.from, range.to, range.value);
    end = range.to;
  }
  return builder.finish();
}

const blockField = StateField.define<DecorationSet>({
  create: blockWidgets,
  update: (value, transaction) =>
    transaction.docChanged ||
    transaction.selection ||
    syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? blockWidgets(transaction.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});

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
          // 任务项的圆点与复选框合并显示，由下方 TaskMarker 一起替换。
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
        const style = marks[name];
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
  // RangeSetBuilder 要求按起点排序；同一起点 line 装饰须先于 mark/replace。
  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, range.value);
  return builder.finish();
}

// 只引用基础变量（--muted、--destructive 等）和一定会输出的 theme 变量：Tailwind v4 会裁掉没被工具类
// 用到的 --color-*，引用它们可能落空。标题用 em，跟随编辑器正文字号缩放。
const theme = EditorView.theme({
  '.cm-md-h': { fontWeight: '600', color: 'var(--foreground)' },
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
    borderLeft: '2px solid var(--border)',
    paddingLeft: 'calc(var(--spacing) * 3)',
    color: 'var(--muted-foreground)',
  },
  '.cm-md-codeblock': {
    fontFamily: 'var(--font-mono)',
    backgroundColor: 'var(--syntax-bg)',
    color: 'var(--syntax-fg)',
  },
  '.cm-md-hr': {
    backgroundImage: 'linear-gradient(var(--input), var(--input))',
    backgroundSize: '100% 2px',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  },
  '.cm-md-bullet': {
    display: 'inline-block',
    width: '1ch',
    textAlign: 'center',
    color: 'var(--muted-foreground)',
  },
  '.cm-md-task': {
    margin: '0 0.5ch 0 0',
    verticalAlign: 'middle',
    cursor: 'pointer',
    accentColor: 'var(--ring)',
  },
  '.cm-md-table': { overflowX: 'auto', paddingBlock: 'calc(var(--spacing) * 2)' },
  '.cm-md-table table': { borderCollapse: 'collapse' },
  '.cm-md-table th, .cm-md-table td': {
    border: '1px solid var(--input)',
    padding: 'calc(var(--spacing) * 1) calc(var(--spacing) * 3)',
  },
  '.cm-md-table th': { fontWeight: '600', backgroundColor: 'var(--muted)' },
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
    color: 'var(--muted-foreground)',
  },
  '.cm-md-mermaid svg': { maxWidth: '100%', height: 'auto' },
  '.cm-md-mermaid-error': { color: 'var(--destructive)', textAlign: 'left' },
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
    blockField,
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
