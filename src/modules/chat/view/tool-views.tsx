import { lazy, Suspense, useState, type ReactNode } from 'react';
import {
  Bot,
  CodeXml,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  Search,
  SquareTerminal,
  TextSearch,
  Wrench,
} from 'lucide-react';
import type { AgentToolResult } from '../../../core/protocol/agent';
import { DiffStat } from '../../../ui/agent/diff-stat';
import { PlainLines } from '../../../ui/agent/plain-lines';
import { SourceList } from '../../../ui/agent/source-list';
import { SourceStack } from '../../../ui/agent/source-stack';
import type { ToolStepStatus } from '../../../ui/agent/tool-step';
import { ToolCard } from '../../../ui/agent/tool-card';
import { Button } from '../../../ui/button';
import { openLightbox } from '../../../ui/lightbox';
import { agentClient } from './client';
import type { Navigate } from '../../../app/module';
import { useSessions } from './sessions';
import { formatDuration } from './format-duration';
import {
  bashExitCode,
  editLineCounts,
  hostnameOf,
  lineCount,
  listingCount,
  parseReadOutput,
  parseWebSearch,
  prettyJson,
} from './tool-output';

const EditDiffCard = lazy(() =>
  import('./review/pierre-diff').then((module) => ({ default: module.EditDiffCard })),
);
const CodeFileCard = lazy(() =>
  import('./review/pierre-diff').then((module) => ({ default: module.CodeFileCard })),
);

// 工具在回复轨迹里的呈现：一张表定义每种工具的图标、动词、对象、折叠行结果与展开视图。
// 输出形状见 core/protocol/agent 的 AgentToolOutput（text + image + 工具 details）。

type ToolTarget = { text: string; title?: string; key?: string };

type ToolEntry = {
  icon: ReactNode;
  doing: string;
  done: string;
  noun: string;
  mono?: boolean;
  /** 失败原因不在展开视图里（视图显示的是输入），需要在视图外补一行。 */
  reasonOutside?: boolean;
  /** key 是 input 中已作为对象显示的字段，通用视图不再重复。 */
  target: (result: AgentToolResult) => ToolTarget;
  /** 进行中与完成后折叠行尾的结果；失败与中断由 stepMeta 统一处理。 */
  meta: (result: AgentToolResult, status: ToolStepStatus) => ReactNode;
  failure?: (result: AgentToolResult) => string | undefined;
  /** 没有可展示的内容时返回 null，该步骤就不可展开。 */
  body: (result: AgentToolResult, failed: boolean) => ReactNode;
};

function inputOf(result: AgentToolResult): Record<string, unknown> {
  return result.input && typeof result.input === 'object'
    ? (result.input as Record<string, unknown>)
    : {};
}

function inputText(result: AgentToolResult, key: string) {
  const value = inputOf(result)[key];
  return typeof value === 'string' ? value : '';
}

function outputText(result: AgentToolResult): string {
  return result.output?.text ?? '';
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function readOffset(result: AgentToolResult) {
  const offset = inputOf(result).offset;
  return typeof offset === 'number' && offset > 1 ? offset : 1;
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-3">{children}</p>;
}

function Body({ children }: { children: ReactNode }) {
  return <div className="min-w-0 space-y-1.5">{children}</div>;
}

function BashView({ result, failed }: { result: AgentToolResult; failed: boolean }) {
  const command = inputText(result, 'command');
  const stdout = outputText(result);
  const lines = [
    ...(command ? [`$ ${command.split('\n')[0]!}`, ...command.split('\n').slice(1)] : []),
    ...(command && stdout ? [''] : []),
    ...(stdout ? stdout.split('\n') : []),
  ];
  return (
    <Body>
      <ToolCard
        bodyClassName="max-h-64 overflow-y-auto"
        copyText={`${command}${command && stdout ? '\n\n' : ''}${stdout}`}
        failed={failed}
        icon={<SquareTerminal aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
        title={`输出 · ${lineCount(stdout)} 行`}
      >
        <PlainLines lines={lines} />
      </ToolCard>
    </Body>
  );
}

function ReadView({
  content,
  path,
  startLine,
  failed,
}: {
  content: string;
  path: string;
  startLine?: number;
  failed: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <Body>
        <CodeFileCard content={content} failed={failed} path={path} startLine={startLine} />
      </Body>
    </Suspense>
  );
}

function TextView({ text, title, failed }: { text: string; title: string; failed: boolean }) {
  return (
    <Body>
      <ToolCard
        bodyClassName="max-h-80 overflow-y-auto"
        copyText={text}
        failed={failed}
        icon={<CodeXml aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
        title={title}
      >
        <PlainLines lines={text.split('\n')} />
      </ToolCard>
    </Body>
  );
}

function ImageView({ result }: { result: AgentToolResult }) {
  const image = result.output!.image!;
  const path = inputText(result, 'path');
  const src = `data:${image.mimeType};base64,${image.data}`;
  return (
    <img
      alt={path}
      className="max-h-80 w-auto max-w-full cursor-zoom-in rounded-card border border-line bg-surface object-contain"
      onClick={() => openLightbox(src, path)}
      src={src}
      title={path || undefined}
    />
  );
}

function WriteView({ result, failed }: { result: AgentToolResult; failed: boolean }) {
  const content = inputText(result, 'content');
  return (
    <Suspense fallback={null}>
      <Body>
        {content ? (
          <CodeFileCard content={content} failed={failed} path={inputText(result, 'path')} />
        ) : (
          <Caption>（空文件）</Caption>
        )}
      </Body>
    </Suspense>
  );
}

type EditInput = { oldText?: string; newText?: string };

function editsOf(result: AgentToolResult) {
  const edits = inputOf(result).edits;
  return (Array.isArray(edits) ? (edits as EditInput[]) : []).filter(
    (edit) => edit.oldText !== undefined && edit.newText !== undefined,
  );
}

function EditView({ result, failed }: { result: AgentToolResult; failed: boolean }) {
  return (
    <Suspense fallback={null}>
      <Body>
        {editsOf(result).map((edit, index) => (
          <EditDiffCard
            failed={failed}
            key={index}
            newText={edit.newText!}
            oldText={edit.oldText!}
            path={inputText(result, 'path')}
          />
        ))}
      </Body>
    </Suspense>
  );
}

/** 子会话不在任何会话列表里：先取快照得到项目归属，再按会话打开标签。 */
export async function openSubagent(taskId: string, navigate: Navigate) {
  const chat = await agentClient['open-session']({ sessionId: taskId });
  useSessions.getState().putChat(taskId, chat);
  navigate({ page: 'chat', projectId: chat.projectId, sessionId: taskId });
}

function WebSearchView({
  results,
  raw,
}: {
  results: { url: string; title: string; snippet: string }[];
  raw: string;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <Body>
      {results.length ? (
        <SourceList
          items={results.map((item, index) => ({
            key: `${index}:${item.url}`,
            url: item.url,
            title: item.title || item.url,
            label: hostnameOf(item.url),
            snippet: item.snippet,
          }))}
        />
      ) : (
        <Caption>没有结果</Caption>
      )}
      <Button
        aria-expanded={showRaw}
        className="-ml-2.5"
        onClick={() => setShowRaw(!showRaw)}
        size="sm"
        variant="ghost"
      >
        原始输出
      </Button>
      {showRaw && (
        <ToolCard
          bodyClassName="max-h-64 overflow-y-auto"
          copyText={raw}
          icon={<CodeXml aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
          title="原始输出"
        >
          <PlainLines lines={(prettyJson(raw) ?? raw).split('\n')} />
        </ToolCard>
      )}
    </Body>
  );
}

function GenericView({ args, text, failed }: { args: string; text: string; failed: boolean }) {
  return (
    <Body>
      {args && (
        <p className="line-clamp-2 font-mono text-xs leading-5 break-words text-ink-3" title={args}>
          {args}
        </p>
      )}
      {text && (
        <ToolCard
          bodyClassName="max-h-64 overflow-y-auto"
          copyText={text}
          failed={failed}
          icon={<CodeXml aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
          title="结果"
        >
          <PlainLines lines={(prettyJson(text) ?? text).split('\n')} />
        </ToolCard>
      )}
    </Body>
  );
}

function genericBody(result: AgentToolResult, failed: boolean) {
  const shownKey = toolEntry(result.name).target(result).key;
  const args = Object.entries(inputOf(result))
    .filter(
      ([key, value]) => key !== shownKey && value !== undefined && value !== null && value !== '',
    )
    .map(([key, value]) => `${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
  const text = outputText(result);
  return args || text ? <GenericView args={args} failed={failed} text={text} /> : null;
}

const pathTarget = (result: AgentToolResult): ToolTarget => {
  const path = inputText(result, 'path');
  return { text: basename(path) || '.', title: path, key: 'path' };
};

const patternTarget = (result: AgentToolResult): ToolTarget => {
  const pattern = inputText(result, 'pattern');
  return { text: pattern, title: pattern, key: 'pattern' };
};

const listingMeta = (unit: string, empty: string) => (result: AgentToolResult) => {
  const text = result.output?.text;
  if (text === undefined) return undefined;
  const count = listingCount(text);
  return count ? `${count} ${unit}` : empty;
};

const listingBody =
  (title: (result: AgentToolResult) => string) => (result: AgentToolResult, failed: boolean) => {
    const text = outputText(result);
    return text ? <TextView failed={failed} text={text} title={title(result)} /> : null;
  };

const toolEntries: Record<string, ToolEntry> = {
  read: {
    icon: <FileText />,
    doing: '正在读取',
    done: '读取',
    noun: '个文件',
    target: pathTarget,
    meta: (result) => {
      const text = result.output?.text;
      if (text === undefined || result.output?.image) return undefined;
      const { shown, range } = parseReadOutput(text, readOffset(result));
      return range ? `第 ${range.from}–${range.to} 行 / 共 ${range.total} 行` : `${shown} 行`;
    },
    body: (result, failed) => {
      if (result.output?.image) return <ImageView result={result} />;
      const text = outputText(result);
      if (!text) return null;
      const offset = readOffset(result);
      return (
        <ReadView
          content={parseReadOutput(text, offset).body}
          failed={failed}
          path={inputText(result, 'path')}
          startLine={offset > 1 && !failed ? offset : undefined}
        />
      );
    },
  },
  write: {
    icon: <FilePlus />,
    doing: '正在写入',
    done: '写入',
    noun: '个文件',
    reasonOutside: true,
    target: pathTarget,
    meta: (result) => {
      const lines = lineCount(inputText(result, 'content'));
      return lines ? `${lines} 行` : undefined;
    },
    body: (result, failed) => <WriteView failed={failed} result={result} />,
  },
  edit: {
    icon: <FilePen />,
    doing: '正在编辑',
    done: '编辑',
    noun: '个文件',
    reasonOutside: true,
    target: pathTarget,
    meta: (result) => {
      const edits = editsOf(result);
      return edits.length ? <DiffStat counts={editLineCounts(edits)} /> : undefined;
    },
    body: (result, failed) =>
      editsOf(result).length ? <EditView failed={failed} result={result} /> : null,
  },
  bash: {
    icon: <SquareTerminal />,
    doing: '正在运行',
    done: '运行',
    noun: '条命令',
    mono: true,
    target: (result) => {
      const command = inputText(result, 'command');
      return { text: command.split('\n')[0]!, title: command, key: 'command' };
    },
    meta: ({ startedAt, finishedAt }) =>
      startedAt !== undefined && finishedAt !== undefined && finishedAt - startedAt >= 2000
        ? formatDuration(finishedAt - startedAt)
        : undefined,
    failure: (result) => {
      const code = bashExitCode(outputText(result));
      return code === undefined ? undefined : `退出码 ${code}`;
    },
    body: (result, failed) =>
      inputText(result, 'command') || outputText(result) ? (
        <BashView failed={failed} result={result} />
      ) : null,
  },
  grep: {
    icon: <TextSearch />,
    doing: '正在搜索',
    done: '搜索',
    noun: '次',
    mono: true,
    target: patternTarget,
    meta: listingMeta('条匹配', '无匹配'),
    body: listingBody((result) => inputText(result, 'pattern')),
  },
  find: {
    icon: <FileSearch />,
    doing: '正在查找',
    done: '查找',
    noun: '次',
    mono: true,
    target: patternTarget,
    meta: listingMeta('个文件', '无结果'),
    body: listingBody((result) => inputText(result, 'pattern')),
  },
  ls: {
    icon: <FolderOpen />,
    doing: '正在查看',
    done: '查看',
    noun: '个目录',
    target: pathTarget,
    meta: listingMeta('项', '空目录'),
    body: listingBody((result) => inputText(result, 'path') || '.'),
  },
  web_search: {
    icon: <Search />,
    doing: '正在搜索网页',
    done: '搜索网页',
    noun: '次',
    target: (result) => {
      const query = inputText(result, 'query');
      return { text: query, title: query, key: 'query' };
    },
    meta: (result) => {
      const parsed = parseWebSearch(outputText(result));
      if (!parsed) return undefined;
      if (!parsed.results.length) return '无结果';
      const hosts = [...new Set(parsed.results.map(({ url }) => hostnameOf(url)))];
      return (
        <>
          {`${parsed.results.length} 个结果`}
          <SourceStack sources={hosts.map((host) => ({ key: host, label: host }))} />
        </>
      );
    },
    body: (result, failed) => {
      const raw = outputText(result);
      const parsed = parseWebSearch(raw);
      return parsed ? (
        <WebSearchView raw={raw} results={parsed.results} />
      ) : (
        genericBody(result, failed)
      );
    },
  },
  web_fetch: {
    icon: <Globe />,
    doing: '正在读取网页',
    done: '读取网页',
    noun: '个',
    target: (result) => {
      const url = inputText(result, 'url');
      return { text: url.replace(/^https?:\/\//i, ''), title: url, key: 'url' };
    },
    meta: () => undefined,
    body: genericBody,
  },
  // 状态与展开内容由 subagent-step.tsx 呈现，这里只给名称与对象。
  task: {
    icon: <Bot />,
    doing: '子 Agent 正在处理',
    done: '子 Agent',
    noun: '个任务',
    target: (result) => ({
      text: inputText(result, 'description'),
      title: inputText(result, 'prompt'),
      key: 'description',
    }),
    meta: () => undefined,
    body: () => null,
  },
};

export function toolEntry(name: string): ToolEntry {
  return (
    toolEntries[name] ?? {
      icon: <Wrench />,
      doing: `正在调用 ${name}`,
      done: `调用 ${name}`,
      noun: '次',
      target: (result) => {
        const key = ['query', 'url', 'path', 'name'].find((field) => inputText(result, field));
        const text = key ? inputText(result, key) : '';
        return { text, title: text, key };
      },
      meta: () => undefined,
      body: genericBody,
    }
  );
}

/** 折叠行尾的结果：中断与失败由这里统一给出，其余交给工具自己的 meta。 */
export function stepMeta(result: AgentToolResult, status: ToolStepStatus): ReactNode {
  const entry = toolEntry(result.name);
  if (status === 'interrupted') return '未完成';
  if (status === 'error') return entry.failure?.(result) ?? '失败';
  return entry.meta(result, status);
}

/** 展开后的内容；没有可展示的内容时为 null。失败原因就是工具输出，多数视图已把它放进卡内。 */
export function toolBody(result: AgentToolResult, failed: boolean): ReactNode {
  const entry = toolEntry(result.name);
  const reason =
    failed && (entry.reasonOutside || !outputText(result))
      ? outputText(result) || '工具没有返回原因'
      : null;
  const view = entry.body(result, failed);
  if (!reason && !view) return null;
  return (
    <>
      {reason && (
        <p className="mb-1.5 break-words whitespace-pre-wrap text-xs leading-5 text-ink-3">
          {reason}
        </p>
      )}
      {view}
    </>
  );
}
