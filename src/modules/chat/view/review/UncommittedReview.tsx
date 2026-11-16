// 未提交改动聚合审阅：会话工作目录相对 Git HEAD 的净变化（含未跟踪文件）。
// 数据按请求时点重算、会随工作区过期，因此提供手动刷新而不轮询；已查看文件仅在当前面板缓存，刷新后失效。
import { useState, type ReactNode } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCompare, RefreshCw, TriangleAlert } from 'lucide-react';
import type { FileChangeDetail } from '../../../../core/protocol/agent';
import { chatClient } from '../client';
import { DiffView } from './DiffView';
import { Centered, STATUS_TEXT, FileIcon, basenameOf, dirnameOf } from './view-utils';
import { IconButton } from '../../../../ui/icon-button';
import { PanelHeader } from '../../../../ui/panel-header';
import { errorMessage } from '../../../../core/protocol/contract';

const REASON_TEXT = {
  'not-git': '此目录不是 Git 仓库',
  'git-unavailable': '未找到 Git 命令，无法读取改动',
  remote: '远程项目的改动在另一台机器上，请在远端查看',
} as const;

type ReviewDetail = Omit<FileChangeDetail, 'before' | 'after'>;
type CachedDetail = { detail: ReviewDetail; bytes: number };
// 按 UTF-16 序列化长度估算缓存体积，控制反复切换大文件时保留的文本量。
const CACHE_BYTE_LIMIT = 16 * 1024 * 1024;

export function UncommittedReview({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const changes = useQuery({
    queryKey: ['chat', 'uncommitted', sessionId],
    queryFn: () => {
      queryClient.removeQueries({ queryKey: ['chat', 'uncommitted-file', sessionId] });
      return chatClient.readUncommittedChanges(sessionId);
    },
    gcTime: 0,
  });
  const busy = changes.isFetching;
  const summary = busy ? undefined : changes.data;
  const files = summary?.files ?? [];
  const selected = files.some((file) => file.path === picked) ? picked : (files[0]?.path ?? null);
  const detailRead = useQuery({
    queryKey: ['chat', 'uncommitted-file', sessionId, selected],
    queryFn:
      summary?.available && selected
        ? async () => {
            const value = await chatClient.readUncommittedFileChange({
              sessionId,
              path: selected,
            });
            const detail: ReviewDetail = {
              path: value.path,
              status: value.status,
              beforeBytes: value.beforeBytes,
              afterBytes: value.afterBytes,
              textDiff: value.textDiff,
              patch: value.patch,
              note: value.note,
            };
            const bytes = JSON.stringify(detail).length * 2;
            const queryCache = queryClient.getQueryCache();
            const cached = queryCache
              .findAll({ queryKey: ['chat', 'uncommitted-file', sessionId] })
              .filter((query) => query.state.data !== undefined)
              .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
            let total = cached.reduce(
              (sum, query) => sum + (query.state.data as CachedDetail).bytes,
              0,
            );
            for (const query of cached) {
              if (total + bytes <= CACHE_BYTE_LIMIT) break;
              total -= (query.state.data as CachedDetail).bytes;
              queryCache.remove(query);
            }
            return { detail, bytes };
          }
        : skipToken,
    select: (cached) => cached.detail,
    staleTime: Infinity,
  });
  const detail = detailRead.data;
  const detailError = detailRead.error ? errorMessage(detailRead.error) : null;

  const shell = (children: ReactNode) => (
    <section aria-label="工作区改动" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <PanelHeader>
        <GitCompare aria-hidden className="size-4 shrink-0 text-ink-3" />
        <span className="shrink-0 text-sm font-medium">工作区改动</span>
        <span
          className="min-w-0 truncate text-xs text-ink-3"
          title={summary?.repositoryRoot ?? undefined}
        >
          {summary?.available ? `${files.length} 个文件` : ''}
        </span>
        <IconButton
          aria-label="刷新改动"
          className="ml-auto"
          disabled={busy}
          onClick={() => void changes.refetch()}
          title="重新读取工作区改动"
        >
          <RefreshCw className={busy ? 'animate-spin' : undefined} />
        </IconButton>
      </PanelHeader>
      {summary && summary.warnings.length > 0 && (
        <div
          aria-label="读取警告"
          className="max-h-32 shrink-0 overflow-auto border-b border-line px-3 py-2 text-xs leading-5 text-ink-3"
          role="status"
        >
          <p>部分改动未能完整读取：</p>
          {summary.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}
      {children}
    </section>
  );

  if (changes.error && !busy)
    return shell(
      <Centered>
        <TriangleAlert aria-hidden className="size-4 text-ink-3" />
        {errorMessage(changes.error)}
      </Centered>,
    );
  if (!summary) return shell(<Centered role="status">正在读取改动…</Centered>);
  if (!summary.available)
    return shell(<Centered>{REASON_TEXT[summary.reason ?? 'not-git']}</Centered>);
  if (files.length === 0)
    return shell(
      <Centered>
        {summary.warnings.length > 0
          ? '无法确认工作区是否存在未提交的改动'
          : '工作区没有未提交的改动'}
      </Centered>,
    );

  return shell(
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="改动文件列表"
        className="w-60 shrink-0 overflow-y-auto border-r border-line py-1"
      >
        {files.map((file) => (
          <button
            aria-current={selected === file.path ? 'true' : undefined}
            className={`flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-fast hover:bg-hover ${
              selected === file.path ? 'bg-hover' : ''
            }`}
            key={file.path}
            onClick={() => setPicked(file.path)}
            title={file.path}
            type="button"
          >
            <FileIcon path={file.path} />
            <span className="shrink-0 truncate">{basenameOf(file.path)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-3">
              {dirnameOf(file.path)}
            </span>
            <span className="shrink-0 text-xs text-ink-3">{STATUS_TEXT[file.status]}</span>
          </button>
        ))}
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {detailError ? (
          <Centered>{detailError}</Centered>
        ) : detail ? (
          <div className="py-2">
            <div className="flex items-center gap-2 px-3 pb-2">
              <span className="text-sm font-medium">{basenameOf(detail.path)}</span>
              <span className="shrink-0 text-xs text-ink-3">· {STATUS_TEXT[detail.status]}</span>
              {detail.note && (
                <span className="min-w-0 truncate text-xs text-ink-3">{detail.note}</span>
              )}
            </div>
            {detail.patch ? (
              <DiffView patch={detail.patch} />
            ) : (
              <Centered>此文件没有可展示的文本差异</Centered>
            )}
          </div>
        ) : (
          <Centered role="status">正在读取差异…</Centered>
        )}
      </div>
    </div>,
  );
}
