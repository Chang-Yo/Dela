import { diffLines, diffWords } from 'diff';
import type { AgentToolResult } from '../../../shared/api';
import type { CodePiece, DiffRow } from '@/components/ui/beautifului/primitives/CodeBlock';
import CodeBlock from '@/components/ui/beautifului/primitives/CodeBlock';
import { ChatMarkdown } from './markdown';

// 工具卡片的正文视图：按工具渲染结构化内容（命令、diff、文件列表等），
// 不再整体展示 input/output 的原始 JSON 信封。代码与输出统一用 beautiful-ui
// CodeBlock 呈现；output 形状与 src/main/agent/tools/kernel/*.ts 的返回值一一对应，
// 读取时全部防御式取值。

type ToolResultData = Record<string, unknown> | undefined;

function data(result: AgentToolResult): ToolResultData {
  const output = result.output as { result?: unknown } | undefined;
  const value = output?.result;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] text-ink-3">{children}</p>;
}

/** 由 oldText → newText 构造 CodeBlock Diff 视图的行：逐行配对的增删之间做
 *  词级对比（pieces），未配对行整行着色。 */
function buildDiffRows(oldText: string, newText: string): DiffRow[] {
  const chunks = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  const pushChunk = (
    chunk: { added?: boolean; removed?: boolean; value: string },
    pair?: { added?: boolean; removed?: boolean; value: string },
  ) => {
    const type = chunk.added ? 'add' : chunk.removed ? 'del' : 'ctx';
    const lines = chunk.value.replace(/\n$/, '').split('\n');
    const pairLines = pair ? pair.value.replace(/\n$/, '').split('\n') : undefined;
    for (let index = 0; index < lines.length; index += 1) {
      if (type === 'del') oldNo += 1;
      if (type === 'add' || type === 'ctx') newNo += 1;
      // 相邻的 del/add 同序行做词级切分，其余整行作为一个 piece。
      const pairLine = pairLines?.[index];
      const pieces: CodePiece[] =
        type === 'del' && pairLine !== undefined && pair?.added
          ? diffWords(lines[index]!, pairLine).map((part) => ({
              text: part.value,
              change: part.added ? 'add' : part.removed ? 'del' : undefined,
            }))
          : [{ text: lines[index]! }];
      rows.push({
        old: type === 'add' ? null : oldNo,
        cur: type === 'del' ? null : newNo,
        type,
        pieces,
      });
    }
    // 配对的 add 块行数更多时，余下行单独入表（上方循环已消耗同序前缀）。
    if (pairLines && pairLines.length > lines.length && pair?.added) {
      for (let index = lines.length; index < pairLines.length; index += 1) {
        newNo += 1;
        rows.push({ old: null, cur: newNo, type: 'add', pieces: [{ text: pairLines[index]! }] });
      }
    }
  };
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const next = chunks[index + 1];
    if (chunk.removed && next?.added) {
      pushChunk(chunk, next);
      index += 1;
    } else {
      pushChunk(chunk);
    }
  }
  return rows;
}

function BashView({ result }: { result: AgentToolResult }) {
  const input = result.input as { command?: string; cancel?: boolean; taskId?: string } | null;
  const output = data(result) as
    | { running?: boolean; exitCode?: number | null; output?: string; truncated?: boolean }
    | undefined;
  const command = input?.command ?? '';
  const stdout = output?.output ?? '';
  if (!command && !stdout) return null;
  // 命令与输出合入一张卡：行首 $ 提示符 + 空行分隔；复制取原始文本（不带提示符）。
  const lines = [
    ...(command ? [`$ ${command.split('\n')[0]!}`, ...command.split('\n').slice(1)] : []),
    ...(command && stdout ? [''] : []),
    ...(stdout ? stdout.split('\n') : []),
  ];
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      <CodeBlock
        bodyClassName="max-h-64 overflow-y-auto"
        code={`${command}${command && stdout ? '\n\n' : ''}${stdout}`}
        filename="Bash"
        fill
        lines={lines}
        plain
      />
      {output?.running && <Caption>运行中…</Caption>}
      {typeof output?.exitCode === 'number' && output.exitCode !== 0 && (
        <Caption>
          <span className="text-red">退出码 {output.exitCode}</span>
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
        <CodeBlock
          bodyClassName="max-h-80 overflow-y-auto"
          filename={path || '目录'}
          fill
          lines={output.entries.map((entry) => (entry.directory ? `${entry.name}/` : entry.name))}
          plain
        />
      )}
      {output?.text && (
        <CodeBlock
          bodyClassName="max-h-80 overflow-y-auto"
          filename={path}
          fill
          lines={output.text.split('\n')}
        />
      )}
      {output?.images?.map((image, index) => (
        <img
          key={index}
          src={image.dataUrl}
          alt={`读取的图片 ${index + 1}`}
          className="max-h-40 rounded-card border border-line/60"
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
      {text ? (
        <CodeBlock
          bodyClassName="max-h-80 overflow-y-auto"
          filename={input?.path ?? ''}
          fill
          lines={text.split('\n')}
        />
      ) : (
        <Caption>（空文件）</Caption>
      )}
    </div>
  );
}

function EditView({ result }: { result: AgentToolResult }) {
  const input = result.input as { path?: string; oldText?: string; newText?: string } | null;
  if (input?.oldText === undefined || input?.newText === undefined) return null;
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      <CodeBlock
        bodyClassName="max-h-80 overflow-y-auto"
        diff={buildDiffRows(input.oldText, input.newText)}
        filename={input.path ?? ''}
        fill
        variant="Diff"
      />
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
        <CodeBlock
          bodyClassName="max-h-80 overflow-y-auto"
          filename="Grep"
          fill
          lines={matches.map((match) => `${match.path}:${match.line} ${match.text}`)}
          plain
        />
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
        <CodeBlock
          bodyClassName="max-h-80 overflow-y-auto"
          filename="Glob"
          fill
          lines={files}
          plain
        />
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
      {output?.text && (
        <CodeBlock
          bodyClassName="max-h-64 overflow-y-auto"
          filename="网页正文"
          fill
          lines={output.text.split('\n')}
          plain
        />
      )}
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
          <p className="text-[13px] font-medium text-ink">{item.title ?? item.url}</p>
          {item.url && <p className="truncate font-mono text-[11px] text-ink-3">{item.url}</p>}
          {item.snippet && (
            <p className="text-[12.5px] leading-relaxed text-ink-2">{item.snippet}</p>
          )}
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
      {/* Skill 正文是 markdown；支持文件按扩展名回落到代码视图。 */}
      {!path || path.endsWith('.md') || path.endsWith('.markdown') ? (
        <div className="max-h-80 overflow-y-auto rounded-card bg-inset p-3 text-xs leading-5 shadow-hairline">
          <ChatMarkdown animated={false}>{text}</ChatMarkdown>
        </div>
      ) : (
        <CodeBlock
          bodyClassName="max-h-80 overflow-y-auto"
          filename={path}
          fill
          lines={text.split('\n')}
        />
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
          <span className="text-ink-3">{key}: </span>
          <span className="text-ink-2">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
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
