'use client';

import { useState, type ReactNode } from 'react';

export type CodeBlockLabels = { copy: string; copied: string };

const KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'default',
  'async',
  'function',
  'const',
  'let',
  'var',
  'await',
  'return',
  'if',
  'else',
  'for',
  'while',
  'new',
  'throw',
  'try',
  'catch',
  'null',
  'true',
  'false',
  'undefined',
]);
const TOKEN =
  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b(?:import|from|export|default|async|function|const|let|var|await|return|if|else|for|while|new|throw|try|catch|null|true|false|undefined)\b|[A-Za-z_$][\w$]*(?=\s*\())/g;

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
    if (/^["'`]/.test(t) || /^\d/.test(t)) color = 'var(--warning)';
    else if (KEYWORDS.has(t)) color = 'var(--accent-ink)';
    else {
      color = 'var(--ink)';
      weight = 500;
    }
    nodes.push(
      <span key={k++} style={{ color, fontWeight: weight }}>
        {t}
      </span>,
    );
    last = idx + t.length;
  }
  if (last < text.length) nodes.push(<span key={k++}>{text.slice(last)}</span>);
  return nodes;
}

function FileIcon() {
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-ink-3"
    >
      <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  );
}

const DEFAULT_LABELS: CodeBlockLabels = { copy: 'Copy', copied: 'Copied' };

export type CodeBlockProps = {
  lines: string[];
  code?: string;
  filename: string;
  labels?: Partial<CodeBlockLabels>;
  onCopy?: (text: string) => void;
  plain?: boolean;
  fill?: boolean;
  bodyClassName?: string;
  tone?: 'error';
};

export default function CodeBlock({
  lines,
  code,
  filename,
  labels,
  onCopy,
  plain = false,
  fill = false,
  bodyClassName,
  tone,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const text = { ...DEFAULT_LABELS, ...labels };
  const raw = code ?? lines.join('\n');

  const copy = () => {
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      onCopy?.(raw);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={`relative ${fill ? 'w-full' : 'w-full max-w-105'} overflow-hidden rounded-card bg-surface shadow-card`}
    >
      {tone === 'error' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[0.1875rem] bg-danger"
        />
      )}
      {/* 文件名保留正常行高：leading-none 会在字号调大后裁掉下划线与字形下缘。 */}
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <span className="inline-flex min-w-0 items-center gap-[0.4375rem]">
          <FileIcon />
          <span className="truncate font-mono leading-normal text-ink">{filename}</span>
        </span>

        <button
          type="button"
          aria-label="Copy code"
          onClick={copy}
          className={`-mr-1 ml-auto flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 text-xs
              font-medium transition-colors duration-fast hover:bg-hover
              ${copied ? 'text-success' : 'text-ink-3 hover:text-ink'}`}
        >
          {copied ? (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="12" height="12" rx="2.5" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
          {copied ? text.copied : text.copy}
        </button>
      </div>

      <div
        className={`py-3 font-mono text-sm leading-[1.65] text-ink-2${bodyClassName ? ` ${bodyClassName}` : ''}`}
      >
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start">
              <span className="select-none text-center text-xs text-ink-3">{i + 1}</span>
              <code className="pr-3 pl-1 break-words whitespace-pre-wrap">
                {plain ? line : highlight(line)}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
