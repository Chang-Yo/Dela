import { diffLines } from 'diff';
import hljs from 'highlight.js/lib/common';
import type { AgentToolResult } from '../../../shared/api';
import { cn } from '../../lib/utils';
import { ChatMarkdown } from './markdown';

// 工具卡片的正文视图：按工具渲染结构化内容（命令、diff、文件列表等），
// 不再整体展示 input/output 的原始 JSON 信封。output 形状与
// src/main/agent/tools/kernel/*.ts 的返回值一一对应，读取时全部防御式取值。

type ToolResultData = Record<string, unknown> | undefined;

function data(result: AgentToolResult): ToolResultData {
  const output = result.output as { result?: unknown } | undefined;
  const value = output?.result;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// 扩展名 → highlight.js 语言；common 包没有的（如 tsx）映射到最近的语法。
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  rb: 'ruby',
  php: 'php',
  diff: 'diff',
  patch: 'diff',
};

function languageOf(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const language = LANGUAGE_BY_EXTENSION[extension];
  return language && hljs.getLanguage(language) ? language : undefined;
}

/** 单行代码内容：能高亮就高亮（hljs 输出已转义），否则渲染纯文本。 */
function CodeLine({ text, language }: { text: string; language?: string }) {
  if (!language) return <>{text}</>;
  return <span dangerouslySetInnerHTML={{ __html: hljs.highlight(text, { language }).value }} />;
}

/** 多行代码块：按扩展名整段高亮，超高滚动。 */
function CodeBlock({ code, path }: { code: string; path: string }) {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre break-words rounded-md bg-muted/50 p-3 font-mono text-xs leading-5">
      <code>
        {code.split('\n').map((line, index) => (
          <span key={index} className="block">
            <CodeLine text={line} language={languageOf(path)} />
          </span>
        ))}
      </code>
    </pre>
  );
}

/** 命令块：行首淡色 $ 提示符 + 命令文本（参考 ZCode 的终端工具卡）。 */
function CommandBlock({ command }: { command: string }) {
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs leading-5">
      <span className="select-none text-muted-foreground">$ </span>
      {command}
    </pre>
  );
}

/** 纯文本输出块（命令输出、网页正文等非代码内容，不做语法高亮）。 */
function TextBlock({ text, tone }: { text: string; tone?: 'destructive' }) {
  return (
    <pre
      className={cn(
        'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs leading-5',
        tone === 'destructive' && 'text-destructive',
      )}
    >
      {text}
    </pre>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** Edit 的局部 diff：oldText → newText 逐行着色，行首 +/- 标记，内容尽量高亮。 */
function DiffView({ oldText, newText, path }: { oldText: string; newText: string; path: string }) {
  const language = languageOf(path);
  const rows = diffLines(oldText, newText).flatMap((chunk) =>
    chunk.value
      .replace(/\n$/, '')
      .split('\n')
      .map((text) => ({
        text,
        kind: (chunk.added ? 'add' : chunk.removed ? 'del' : 'ctx') as 'add' | 'del' | 'ctx',
      })),
  );
  return (
    <div className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 py-2 font-mono text-xs leading-5">
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn(
            '-mx-3 px-3',
            row.kind === 'add' && 'bg-success/10',
            row.kind === 'del' && 'bg-destructive/10',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'select-none',
              row.kind === 'add' && 'text-success',
              row.kind === 'del' && 'text-destructive',
            )}
          >
            {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
          </span>
          {row.text && <CodeLine text={row.text} language={language} />}
        </div>
      ))}
    </div>
  );
}

function BashView({ result }: { result: AgentToolResult }) {
  const input = result.input as { command?: string; cancel?: boolean; taskId?: string } | null;
  const output = data(result) as
    | { running?: boolean; exitCode?: number | null; output?: string; truncated?: boolean }
    | undefined;
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {input?.command && <CommandBlock command={input.command} />}
      {output?.output && <TextBlock text={output.output} />}
      {output?.running && !output.output && <Caption>等待输出…</Caption>}
      {output?.running && output.output && <Caption>运行中…</Caption>}
      {typeof output?.exitCode === 'number' && output.exitCode !== 0 && (
        <Caption>
          <span className="text-destructive">退出码 {output.exitCode}</span>
        </Caption>
      )}
      {output?.truncated && <Caption>输出已截断</Caption>}
    </div>
  );
}

function ReadView({ result }: { result: AgentToolResult }) {
  const output = data(result) as
    | {
        path?: string;
        text?: string;
        entries?: { name: string; directory: boolean }[];
        images?: { dataUrl: string }[];
        totalLines?: number;
        truncated?: boolean;
      }
    | undefined;
  const input = result.input as { path?: string } | null;
  const path = output?.path ?? input?.path ?? '';
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {output?.entries && (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-5">
          {output.entries.map((entry) => `${entry.directory ? `${entry.name}/` : entry.name}\n`)}
        </pre>
      )}
      {output?.text && <CodeBlock code={output.text} path={path} />}
      {output?.images?.map((image, index) => (
        <img
          key={index}
          src={image.dataUrl}
          alt={`读取的图片 ${index + 1}`}
          className="max-h-40 rounded-md border border-border/60"
        />
      ))}
      {typeof output?.totalLines === 'number' && (
        <Caption>
          共 {output.totalLines} 行{output.truncated ? ' · 已截断' : ''}
        </Caption>
      )}
    </div>
  );
}

function WriteView({ result }: { result: AgentToolResult }) {
  const input = result.input as { path?: string; text?: string } | null;
  const text = input?.text ?? '';
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {text ? <CodeBlock code={text} path={input?.path ?? ''} /> : <Caption>（空文件）</Caption>}
    </div>
  );
}

function EditView({ result }: { result: AgentToolResult }) {
  const input = result.input as { path?: string; oldText?: string; newText?: string } | null;
  if (input?.oldText === undefined || input?.newText === undefined) return null;
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      <DiffView oldText={input.oldText} newText={input.newText} path={input.path ?? ''} />
    </div>
  );
}

function GrepView({ result }: { result: AgentToolResult }) {
  const output = data(result) as
    | {
        matches?: { path: string; line: number; text: string }[];
        filesScanned?: number;
        truncated?: boolean;
      }
    | undefined;
  const matches = output?.matches ?? [];
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {matches.length > 0 && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs leading-5">
          {matches.map((match) => (
            <span key={`${match.path}:${match.line}`} className="block">
              <span className="text-muted-foreground">
                {match.path}:{match.line}
              </span>
              {match.text}
            </span>
          ))}
        </pre>
      )}
      <Caption>
        {matches.length} 处匹配
        {typeof output?.filesScanned === 'number' ? ` · 扫描 ${output.filesScanned} 个文件` : ''}
        {output?.truncated ? ' · 已达上限' : ''}
      </Caption>
    </div>
  );
}

function GlobView({ result }: { result: AgentToolResult }) {
  const output = data(result) as { files?: string[]; truncated?: boolean } | undefined;
  const files = output?.files ?? [];
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {files.length > 0 && (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-5">
          {files.map((file) => `${file}\n`)}
        </pre>
      )}
      <Caption>
        {files.length} 个文件{output?.truncated ? ' · 已达上限' : ''}
      </Caption>
    </div>
  );
}

function WebFetchView({ result }: { result: AgentToolResult }) {
  const output = data(result) as { title?: string | null; text?: string } | undefined;
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {output?.title && <Caption>{output.title}</Caption>}
      {output?.text && <TextBlock text={output.text} />}
    </div>
  );
}

function WebSearchView({ result }: { result: AgentToolResult }) {
  const output = data(result) as
    { results?: { url?: string; title?: string; snippet?: string }[] } | undefined;
  const results = output?.results ?? [];
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {results.map((item, index) => (
        <div key={index} className="space-y-0.5">
          <p className="text-xs font-medium text-foreground">{item.title ?? item.url}</p>
          {item.url && <p className="truncate text-[11px] text-muted-foreground">{item.url}</p>}
          {item.snippet && <p className="text-xs text-muted-foreground">{item.snippet}</p>}
        </div>
      ))}
    </div>
  );
}

function ReadSkillsView({ result }: { result: AgentToolResult }) {
  const output = data(result) as { text?: string; path?: string; note?: string } | undefined;
  const text = str(output?.text);
  if (!text) return null;
  const path = output?.path ?? '';
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {/* Skill 正文是 markdown；支持文件按扩展名回落到代码高亮。 */}
      {!path || path.endsWith('.md') || path.endsWith('.markdown') ? (
        <div className="max-h-80 overflow-y-auto rounded-md bg-muted/50 p-3 text-xs leading-5">
          <ChatMarkdown animated={false}>{text}</ChatMarkdown>
        </div>
      ) : (
        <CodeBlock code={text} path={path} />
      )}
      {output?.note && <Caption>{output.note}</Caption>}
    </div>
  );
}

/** 兜底视图：input 的键值对逐行展示；不渲染 ok/result 之类的信封包装。 */
function GenericView({ result }: { result: AgentToolResult }) {
  const input = result.input;
  const entries =
    input && typeof input === 'object' ? Object.entries(input as Record<string, unknown>) : [];
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1">
      {entries.map(([key, value]) => (
        <p key={key} className="break-words text-xs leading-5">
          <span className="text-muted-foreground">{key}: </span>
          {typeof value === 'string' ? value : JSON.stringify(value)}
        </p>
      ))}
    </div>
  );
}

export function ToolBody({ result }: { result: AgentToolResult }) {
  switch (result.name) {
    case 'Bash':
      return <BashView result={result} />;
    case 'Read':
      return <ReadView result={result} />;
    case 'Write':
      return <WriteView result={result} />;
    case 'Edit':
      return <EditView result={result} />;
    case 'Grep':
      return <GrepView result={result} />;
    case 'Glob':
      return <GlobView result={result} />;
    case 'WebFetch':
      return <WebFetchView result={result} />;
    case 'WebSearch':
      return <WebSearchView result={result} />;
    case 'ReadSkills':
      return <ReadSkillsView result={result} />;
    default:
      return <GenericView result={result} />;
  }
}
