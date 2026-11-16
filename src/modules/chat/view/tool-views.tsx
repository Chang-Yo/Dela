import { lazy, Suspense } from 'react';
import type { AgentToolResult, SubagentDetails } from '../../../core/protocol/agent';
import { CodeXml, Terminal } from 'lucide-react';
import { PlainLines, ToolCard } from '../../../ui/agent/tool-card';
import { openLightbox } from '../../../ui/lightbox';
import { Button } from '../../../ui/button';
import { agentClient } from './client';
import type { Navigate } from '../../../app/module';
import { useChatTabSource } from './chat-source';
import { useSessions } from './sessions';
import { ChatMarkdown } from './markdown';

const EditDiffCard = lazy(() =>
  import('./review/pierre-diff').then((module) => ({ default: module.EditDiffCard })),
);
const CodeFileCard = lazy(() =>
  import('./review/pierre-diff').then((module) => ({ default: module.CodeFileCard })),
);

// 工具卡片的正文视图：按 Pi 内置工具（read/write/edit/bash/grep/find/ls）渲染输入与文本输出，
// read 读到图片时直接预览图片本体。输出形状见 core/protocol/agent 的 AgentToolOutput（text + image + 工具 details）。

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-3">{children}</p>;
}

type ViewProps = { result: AgentToolResult; failed: boolean };

function outputText(result: AgentToolResult): string {
  return result.output?.text ?? '';
}

function BashView({ result, failed }: ViewProps) {
  const command = (result.input as { command?: string } | null)?.command ?? '';
  const stdout = outputText(result);
  if (!command && !stdout) return null;
  const lines = [
    ...(command ? [`$ ${command.split('\n')[0]!}`, ...command.split('\n').slice(1)] : []),
    ...(command && stdout ? [''] : []),
    ...(stdout ? stdout.split('\n') : []),
  ];
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      <ToolCard
        bodyClassName="max-h-64 overflow-y-auto"
        copyText={`${command}${command && stdout ? '\n\n' : ''}${stdout}`}
        failed={failed}
        icon={<Terminal aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
        title="bash"
      >
        <PlainLines lines={lines} />
      </ToolCard>
    </div>
  );
}

function ReadView({ result, title, failed }: ViewProps & { title: string }) {
  const text = outputText(result);
  if (!text) return null;
  return (
    <Suspense fallback={null}>
      <div className="mb-1 mt-1 min-w-0 space-y-1.5">
        <CodeFileCard content={text} failed={failed} path={title} />
      </div>
    </Suspense>
  );
}

function TextView({ result, title, failed }: ViewProps & { title: string }) {
  const text = outputText(result);
  if (!text) return null;
  return (
    <div className="mb-1 mt-1 min-w-0 space-y-1.5">
      <ToolCard
        bodyClassName="max-h-80 overflow-y-auto"
        copyText={text}
        failed={failed}
        icon={<CodeXml aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
        title={title}
      >
        <PlainLines lines={text.split('\n')} />
      </ToolCard>
    </div>
  );
}

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
    <Suspense fallback={null}>
      <div className="mb-1 mt-1 min-w-0 space-y-1.5">
        {text ? (
          <CodeFileCard content={text} failed={failed} path={input?.path ?? ''} />
        ) : (
          <Caption>（空文件）</Caption>
        )}
      </div>
    </Suspense>
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
    <Suspense fallback={null}>
      <div className="mb-1 mt-1 min-w-0 space-y-1.5">
        {edits.map((edit, index) => (
          <EditDiffCard
            failed={failed}
            key={index}
            newText={edit.newText!}
            oldText={edit.oldText!}
            path={input?.path ?? ''}
          />
        ))}
      </div>
    </Suspense>
  );
}

/** 子会话不在任何会话列表里：先取快照得到项目归属，再按会话打开标签。 */
export async function openSubagent(taskId: string, navigate: Navigate) {
  const chat = await agentClient['open-session']({ sessionId: taskId });
  useSessions.getState().putChat(taskId, chat);
  navigate({ page: 'chat', projectId: chat.projectId, sessionId: taskId });
}

function SubagentView({ result }: ViewProps) {
  const { navigate } = useChatTabSource();
  const details = result.output?.details as SubagentDetails | undefined;
  const prompt = (result.input as { prompt?: string } | null)?.prompt ?? '';
  return (
    <div className="mb-1 mt-1 grid min-w-0 gap-1.5">
      {prompt && (
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-ink-3">
          {prompt}
        </p>
      )}
      {details?.reply && (
        <div className="max-h-80 overflow-y-auto rounded-card border border-line px-3 py-2 text-sm leading-6">
          <ChatMarkdown animated={false}>{details.reply}</ChatMarkdown>
        </div>
      )}
      {details && (
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <span>{details.background ? '后台运行，结束时通知' : `共 ${details.steps} 步`}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void openSubagent(details.taskId, navigate)}
          >
            打开子会话
          </Button>
        </div>
      )}
    </div>
  );
}

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
        <ToolCard
          bodyClassName="max-h-64 overflow-y-auto"
          copyText={text}
          failed={failed}
          icon={<CodeXml aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
          title={result.name}
        >
          <PlainLines lines={text.split('\n')} />
        </ToolCard>
      )}
    </div>
  );
}

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
        <ReadView failed={failed} result={result} title={str('path')} />
      );
    case 'ls':
      return <TextView failed={failed} result={result} title={str('path') || '.'} />;
    case 'grep':
    case 'find':
      return <TextView failed={failed} result={result} title={str('pattern')} />;
    case 'task':
      return <SubagentView failed={failed} result={result} />;
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
  // 失败原因就是工具输出：多数视图已把它放进卡内；write/edit 卡内是输入，输出为空时补一行说明。
  const reasonOutsideBlock =
    failed &&
    (result.name === 'write' ||
      result.name === 'edit' ||
      result.name === 'task' ||
      !outputText(result));
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
