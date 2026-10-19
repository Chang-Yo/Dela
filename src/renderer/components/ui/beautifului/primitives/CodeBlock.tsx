"use client";

import { useCallback, useState, type ReactNode } from "react";

const FILE = "churn.ts";

const CODE_LINES = [
  "export async function churnBatch() {",
  '  const flavor = await getFlavor("pistachio");',
  "  const base = await dairy.fetch({ flavor });",
  '  await freezer.store(base, { temp: "-16C" });',
  "  if (!base.approved) return null;",
  "  return base.gallons;",
  "}",
];

export type CodePiece = { text: string; change?: "add" | "del" };
export type DiffRow = {
  old: number | null;
  cur: number | null;
  type: "ctx" | "add" | "del";
  pieces: CodePiece[];
};
export type CodeBlockLabels = { copy: string; copied: string };

// Back-compat internal aliases for the local component signatures.
type Piece = CodePiece;
type Row = DiffRow;

const DIFF: Row[] = [
  { old: 1, cur: 1, type: "ctx", pieces: [{ text: "export async function churnBatch() {" }] },
  { old: 2, cur: 2, type: "ctx", pieces: [{ text: '  const flavor = await getFlavor("pistachio");' }] },
  { old: 3, cur: 3, type: "ctx", pieces: [{ text: "  const base = await dairy.fetch({ flavor });" }] },
  { old: 4, cur: null, type: "del", pieces: [{ text: "  await freezer.store(base, { temp: " }, { text: '"-14C"', change: "del" }, { text: " });" }] },
  { old: null, cur: 4, type: "add", pieces: [{ text: "  await freezer.store(base, { temp: " }, { text: '"-16C"', change: "add" }, { text: " });" }] },
  { old: null, cur: 5, type: "add", pieces: [{ text: "  if (!base.approved) return null;" }] },
  { old: 5, cur: 6, type: "ctx", pieces: [{ text: "  return base.gallons;" }] },
  { old: 6, cur: 7, type: "ctx", pieces: [{ text: "}" }] },
];

const HATCH = "repeating-linear-gradient(45deg, var(--red) 0, var(--red) 1.5px, transparent 1.5px, transparent 3px)";

const KEYWORDS = new Set(["import", "from", "export", "default", "async", "function", "const", "let", "var", "await", "return", "if", "else", "for", "while", "new", "throw", "try", "catch", "null", "true", "false", "undefined"]);
const TOKEN = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b(?:import|from|export|default|async|function|const|let|var|await|return|if|else|for|while|new|throw|try|catch|null|true|false|undefined)\b|[A-Za-z_$][\w$]*(?=\s*\())/g;

function highlight(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    const t = m[0];
    if (idx > last) nodes.push(<span key={k++}>{text.slice(last, idx)}</span>);
    let color: string;
    let weight: number | undefined;
    if (/^["'`]/.test(t) || /^\d/.test(t)) color = "var(--orange)";
    else if (KEYWORDS.has(t)) color = "var(--bui-accent-ink)";
    else { color = "var(--ink)"; weight = 500; }
    nodes.push(<span key={k++} style={{ color, fontWeight: weight }}>{t}</span>);
    last = idx + t.length;
  }
  if (last < text.length) nodes.push(<span key={k++}>{text.slice(last)}</span>);
  return nodes;
}

function Pieces({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      {pieces.map((p, i) => {
        if (p.change) {
          const add = p.change === "add";
          return (
            <span
              key={i}
              className="rounded-[0.1875rem]"
              style={{
                background: `color-mix(in srgb, var(--${add ? "green" : "red"}) 18%, transparent)`,
                padding: "0 0.125rem",
                margin: "0 -0.0625rem",
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }}
            >
              {highlight(p.text)}
            </span>
          );
        }
        return <span key={i}>{highlight(p.text)}</span>;
      })}
    </>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-3">
      <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  );
}

const DEFAULT_LABELS: CodeBlockLabels = { copy: "Copy", copied: "Copied" };

export type CodeBlockProps = {
  /** "Code" (line-numbered listing) or "Diff". */
  variant?: string;
  lines?: string[];
  /** Defaults to `lines` joined. */
  code?: string;
  diff?: DiffRow[];
  filename?: string;
  labels?: Partial<CodeBlockLabels>;
  onCopy?: (text: string) => void;
  /** Dela 适配：纯文本模式——跳过内置语法高亮（stdout、网页正文等非代码内容）。 */
  plain?: boolean;
  /** Dela 适配：填充父容器宽度（默认限制在 26rem 展示宽度）。 */
  fill?: boolean;
  /** Dela 适配：追加到代码主体的类名（聊天内限高滚动等场景）。 */
  bodyClassName?: string;
  /** Dela 适配：失败态——卡片左侧一条 --red 色条（沿用 Diff 视图增删色条的写法）。 */
  tone?: "error";
};

export default function CodeBlock({
  variant = "Code",
  lines = CODE_LINES,
  code,
  diff = DIFF,
  filename = FILE,
  labels,
  onCopy,
  plain = false,
  fill = false,
  bodyClassName,
  tone,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isDiff = variant === "Diff";
  const text = { ...DEFAULT_LABELS, ...labels };
  const raw = code ?? lines.join("\n");

  const copy = useCallback(() => {
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      onCopy?.(raw);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [raw, onCopy]);

  const added = diff.filter((r) => r.type === "add").length;
  const removed = diff.filter((r) => r.type === "del").length;

  return (
    <div
      className={`relative ${fill ? "w-full" : "w-full max-w-105"} overflow-hidden rounded-card bg-surface shadow-card`}
    >
      {/* Dela 适配：失败态色条需盖住 Diff 的整行底色，故置于顶层。 */}
      {tone === "error" && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[0.1875rem] bg-red" />
      )}
      {/* Dela 适配：文件名保留正常行高；leading-none 的 1em 行盒会在字号调大后裁掉下划线与字形下缘。 */}
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 py-2 text-13">
        <span className="inline-flex min-w-0 items-center gap-[0.4375rem]">
          <FileIcon />
          <span className="truncate font-mono leading-normal text-ink">{filename}</span>
        </span>

        {isDiff ? (
          <span className="ml-auto inline-flex items-center gap-2 font-mono text-xs leading-none tabular-nums">
            <span className="text-green">+{added}</span>
            <span className="text-red">-{removed}</span>
          </span>
        ) : (
          <button
            type="button"
            aria-label="Copy code"
            onClick={copy}
            // Dela 适配：长路径下保留按钮宽度，避免继承聊天区换行规则后拆开 Copy / Copied。
            className={`-mr-1 ml-auto flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 text-xs
              font-medium transition-colors duration-100 hover:bg-hover
              ${copied ? "text-green" : "text-ink-3 hover:text-ink"}`}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
            {copied ? text.copied : text.copy}
          </button>
        )}
      </div>

      <div className={`py-3 font-mono text-13 leading-[1.65] text-ink-2${bodyClassName ? ` ${bodyClassName}` : ""}`}>
        {isDiff ? (
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />
            {diff.map((r, i) => {
              const add = r.type === "add";
              const del = r.type === "del";
              // one gutter column: removals keep the old number, additions/context show the new one
              const num = del ? r.old : r.cur;
              return (
                <div
                  key={i}
                  className={`relative grid grid-cols-[1.25rem_minmax(0,1fr)] items-start
                    ${add ? "bg-green-tint" : del ? "bg-red-tint" : ""}`}
                >
                  {(add || del) && (
                    <span className="absolute inset-y-0 left-0 w-[0.1875rem]" style={{ background: add ? "var(--green)" : HATCH }} />
                  )}
                  <span className={`select-none text-center text-2xs ${add ? "text-green" : del ? "text-red" : "text-ink-3"}`}>{num ?? ""}</span>
                  <code className="pr-3 pl-1 break-words whitespace-pre-wrap">
                    {plain ? r.pieces.map((piece, i) => <span key={i}>{piece.text}</span>) : <Pieces pieces={r.pieces} />}
                  </code>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start">
                <span className="select-none text-center text-2xs text-ink-3">{i + 1}</span>
                <code className="pr-3 pl-1 break-words whitespace-pre-wrap">{plain ? line : highlight(line)}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
