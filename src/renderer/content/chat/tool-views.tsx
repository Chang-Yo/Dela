import { diffLines, diffWords } from 'diff';
import type { AgentToolResult } from '../../../shared/api';
import type { CodePiece, DiffRow } from '@/components/ui/beautifului/primitives/CodeBlock';
import CodeBlock from '@/components/ui/beautifului/primitives/CodeBlock';

// 工具卡片的正文视图：按 Pi 内置工具（read/write/edit/bash/grep/find/ls）渲染输入与文本输出。
// 输出形状见 shared/session.ts 的 AgentToolOutput（text + 工具 details）。

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] text-ink-3">{children}</p>;
}

function outputText(result: AgentToolResult): string {
  return result.output?.text ?? '';
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
  const command = (result.input as { command?: string } | null)?.command ?? '';
  const stdout = outputText(result);
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
        filename="bash"
        fill
        lines={lines}
        plain
      />
    </div>
  );
}

/** read/grep/find/ls：路径或模式做标题，文本输出原样展示。 */
function TextView({ result, title }: { result: AgentToolResult; title: string }) {
  const text = outputText(result);
  if (!text) return null;
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      <CodeBlock
        bodyClassName="max-h-80 overflow-y-auto"
        filename={title}
        fill
        lines={text.split('\n')}
        plain={result.name !== 'read'}
      />
    </div>
  );
}

function WriteView({ result }: { result: AgentToolResult }) {
  const input = result.input as { path?: string; content?: string } | null;
  const text = input?.content ?? '';
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
  const input = result.input as {
    path?: string;
    edits?: { oldText?: string; newText?: string }[];
  } | null;
  const edits = (input?.edits ?? []).filter(
    (edit) => edit.oldText !== undefined && edit.newText !== undefined,
  );
  if (!edits.length) return null;
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      {edits.map((edit, index) => (
        <CodeBlock
          key={index}
          bodyClassName="max-h-80 overflow-y-auto"
          diff={buildDiffRows(edit.oldText!, edit.newText!)}
          filename={input?.path ?? ''}
          fill
          variant="Diff"
        />
      ))}
    </div>
  );
}

/** 兜底视图（MCP、联网等自定义工具）：输入键值对 + 文本输出。 */
function GenericView({ result }: { result: AgentToolResult }) {
  const input = result.input;
  const entries =
    input && typeof input === 'object' ? Object.entries(input as Record<string, unknown>) : [];
  const text = outputText(result);
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1">
      {entries.map(([key, value]) => (
        <p key={key} className="break-words text-[12px] leading-5">
          <span className="text-ink-3">{key}: </span>
          <span className="text-ink-2">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
        </p>
      ))}
      {text && (
        <CodeBlock
          bodyClassName="max-h-64 overflow-y-auto"
          filename={result.name}
          fill
          lines={text.split('\n')}
          plain
        />
      )}
    </div>
  );
}

export function ToolBody({ result }: { result: AgentToolResult }) {
  const input = (result.input ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  switch (result.name) {
    case 'bash':
      return <BashView result={result} />;
    case 'write':
      return <WriteView result={result} />;
    case 'edit':
      return <EditView result={result} />;
    case 'read':
      return <TextView result={result} title={str('path')} />;
    case 'ls':
      return <TextView result={result} title={str('path') || '.'} />;
    case 'grep':
    case 'find':
      return <TextView result={result} title={str('pattern')} />;
    default:
      return <GenericView result={result} />;
  }
}
