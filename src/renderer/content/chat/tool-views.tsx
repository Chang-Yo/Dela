import { diffLines, diffWords } from 'diff';
import type { AgentToolResult } from '../../../shared/api';
import type { CodePiece, DiffRow } from '@/components/ui/beautifului/primitives/CodeBlock';
import CodeBlock from '@/components/ui/beautifului/primitives/CodeBlock';
import { openLightbox } from '@/components/ui/lightbox';

// 工具卡片的正文视图：按 Pi 内置工具（read/write/edit/bash/grep/find/ls）渲染输入与文本输出，
// read 读到图片时直接预览图片本体。输出形状见 shared/session.ts 的 AgentToolOutput（text + image + 工具 details）。

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-3">{children}</p>;
}

/** 视图公共入参：failed 让工具卡带失败态（CodeBlock 左侧色条），输入输出结构不变。 */
type ViewProps = { result: AgentToolResult; failed: boolean };

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

function BashView({ result, failed }: ViewProps) {
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
        tone={failed ? 'error' : undefined}
      />
    </div>
  );
}

/** read/grep/find/ls：路径或模式做标题，文本输出原样展示。 */
function TextView({ result, title, failed }: ViewProps & { title: string }) {
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
        tone={failed ? 'error' : undefined}
      />
    </div>
  );
}

/** read 读到图片：图片本体随工具结果投影过来，直接预览，占位文本不再展示。 */
function ImageView({ result }: ViewProps) {
  const image = result.output?.image;
  if (!image) return null;
  const path = (result.input as { path?: string } | null)?.path ?? '';
  const src = `data:${image.mimeType};base64,${image.data}`;
  return (
    <div className="mb-1 mt-1 min-w-0">
      <img
        alt={path}
        className="max-h-80 w-auto max-w-full cursor-zoom-in rounded-card border border-line bg-surface object-contain"
        onClick={() => openLightbox(src, path)}
        src={src}
        title={path || undefined}
      />
    </div>
  );
}

function WriteView({ result, failed }: ViewProps) {
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
          tone={failed ? 'error' : undefined}
        />
      ) : (
        <Caption>（空文件）</Caption>
      )}
    </div>
  );
}

function EditView({ result, failed }: ViewProps) {
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
          tone={failed ? 'error' : undefined}
          variant="Diff"
        />
      ))}
    </div>
  );
}

/** 兜底视图（MCP、联网等自定义工具）：输入键值对 + 文本输出。 */
function GenericView({ result, failed }: ViewProps) {
  const input = result.input;
  const entries =
    input && typeof input === 'object' ? Object.entries(input as Record<string, unknown>) : [];
  const text = outputText(result);
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
      {text && (
        <CodeBlock
          bodyClassName="max-h-64 overflow-y-auto"
          filename={result.name}
          fill
          lines={text.split('\n')}
          plain
          tone={failed ? 'error' : undefined}
        />
      )}
    </div>
  );
}

/** 工具视图的主体：按工具把输入与输出渲染成代码块形态。 */
function ToolView({ result, failed }: ViewProps) {
  const input = (result.input ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  switch (result.name) {
    case 'bash':
      return <BashView failed={failed} result={result} />;
    case 'write':
      return <WriteView failed={failed} result={result} />;
    case 'edit':
      return <EditView failed={failed} result={result} />;
    case 'read':
      return result.output?.image ? (
        <ImageView failed={failed} result={result} />
      ) : (
        <TextView failed={failed} result={result} title={str('path')} />
      );
    case 'ls':
      return <TextView failed={failed} result={result} title={str('path') || '.'} />;
    case 'grep':
    case 'find':
      return <TextView failed={failed} result={result} title={str('pattern')} />;
    default:
      return <GenericView failed={failed} result={result} />;
  }
}

export function ToolBody({
  result,
  failed = false,
}: {
  result: AgentToolResult;
  failed?: boolean;
}) {
  // 失败原因就是工具输出：bash/read/grep 等视图已把它放进卡内，不重复；
  // write/edit 卡内是输入内容，输出为空时也无可看内容，这两种情况补一行说明，
  // 保证失败原因不会因为改用工具视图而消失。
  const reasonOutsideBlock =
    failed && (result.name === 'write' || result.name === 'edit' || !outputText(result));
  return (
    <>
      {reasonOutsideBlock && (
        <p className="mb-1.5 break-words whitespace-pre-wrap text-xs leading-5 text-ink-3">
          {outputText(result) || '工具没有返回原因'}
        </p>
      )}
      <ToolView failed={failed} result={result} />
    </>
  );
}
