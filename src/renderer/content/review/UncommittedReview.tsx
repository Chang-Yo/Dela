// 未提交改动聚合审阅：会话工作目录相对 Git HEAD 的净变化（含未跟踪文件）。
// 数据按请求时点重算、会随工作区过期，因此提供手动刷新而不轮询；已查看文件仅在当前面板缓存，刷新后失效。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { GitCompare, RefreshCw, TriangleAlert } from 'lucide-react';
import type { FileChangeDetail, UncommittedChanges } from '../../../shared/api';
import { DiffView } from './DiffView';
import { Centered, STATUS_TEXT, FileIcon, basenameOf, dirnameOf } from './view-utils';
import { IconButton } from '@/components/ui/beautifului/atoms/IconButton';
import { errorText } from '../../workspace/store';

const REASON_TEXT = {
  'not-git': '此目录不是 Git 仓库',
  'git-unavailable': '未找到 Git 命令，无法读取改动',
  remote: '远程项目的改动在另一台机器上，请在远端查看',
} as const;

type ReviewDetail = Omit<FileChangeDetail, 'before' | 'after'>;
// 按 UTF-16 序列化长度估算缓存体积，控制反复切换大文件时保留的文本量。
const CACHE_BYTE_LIMIT = 16 * 1024 * 1024;

export function UncommittedReview({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<UncommittedChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // load 只刷新列表；当前选中项经 ref 参与「刷新后尽量保持选中」的判定，
  // 选文件的动作不进入 load 的依赖——换选不能触发整表重扫。
  const selectedRef = useRef<string | null>(null);
  const cacheRef = useRef({
    files: new Map<string, { detail: ReviewDetail; bytes: number }>(),
    bytes: 0,
  });
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    cacheRef.current = { files: new Map(), bytes: 0 };
    setSummary(null);
    setBusy(true);
    setError(null);
    try {
      const value = await window.dela!.chat.readUncommittedChanges(sessionId);
      if (version !== loadVersion.current) return;
      setSummary(value);
      const alive = new Set(value.files.map((file) => file.path));
      const next =
        selectedRef.current && alive.has(selectedRef.current)
          ? selectedRef.current
          : (value.files[0]?.path ?? null);
      selectedRef.current = next;
      setSelected(next);
    } catch (cause) {
      if (version === loadVersion.current) setError(errorText(cause));
    } finally {
      if (version === loadVersion.current) setBusy(false);
    }
  }, [sessionId]);

  useEffect(() => {
    selectedRef.current = null;
    setSelected(null);
    setSummary(null);
    void load();
    return () => {
      loadVersion.current += 1;
      cacheRef.current = { files: new Map(), bytes: 0 };
    };
  }, [load]);

  // 选中文件按请求时点读取 diff；换选或刷新列表后重取。
  useEffect(() => {
    if (!summary?.available || !selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let alive = true;
    const cache = cacheRef.current;
    const cached = cache.files.get(selected)?.detail;
    setDetail(cached ?? null);
    setDetailError(null);
    if (cached) return;
    void window.dela?.chat
      .readUncommittedFileChange(sessionId, selected)
      .then((value) => {
        if (!alive) return;
        const lean: ReviewDetail = {
          path: value.path,
          status: value.status,
          beforeBytes: value.beforeBytes,
          afterBytes: value.afterBytes,
          textDiff: value.textDiff,
          patch: value.patch,
          note: value.note,
        };
        const bytes = JSON.stringify(lean).length * 2;
        if (bytes <= CACHE_BYTE_LIMIT) {
          while (cache.bytes + bytes > CACHE_BYTE_LIMIT && cache.files.size > 0) {
            const oldest = cache.files.keys().next().value!;
            cache.bytes -= cache.files.get(oldest)!.bytes;
            cache.files.delete(oldest);
          }
          cache.files.set(selected, { detail: lean, bytes });
          cache.bytes += bytes;
        }
        setDetail(lean);
      })
      .catch((cause: unknown) => {
        if (alive) setDetailError(errorText(cause));
      });
    return () => {
      alive = false;
    };
  }, [sessionId, selected, summary]);

  const files = summary?.files ?? [];
  const select = (path: string) => {
    selectedRef.current = path;
    setSelected(path);
  };
  const shell = (children: ReactNode) => (
    <section aria-label="工作区改动" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <GitCompare aria-hidden className="size-4 shrink-0 text-ink-3" />
        <span className="shrink-0 text-13 font-medium">工作区改动</span>
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
          onClick={() => void load()}
          title="重新读取工作区改动"
        >
          <RefreshCw className={busy ? 'animate-spin' : undefined} />
        </IconButton>
      </header>
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

  if (error)
    return shell(
      <Centered>
        <TriangleAlert aria-hidden className="size-4 text-ink-3" />
        {error}
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
            className={`flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-13 transition-colors duration-100 hover:bg-hover ${
              selected === file.path ? 'bg-hover' : ''
            }`}
            key={file.path}
            onClick={() => select(file.path)}
            title={file.path}
            type="button"
          >
            <FileIcon path={file.path} />
            <span className="shrink-0 truncate">{basenameOf(file.path)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-3">
              {dirnameOf(file.path)}
            </span>
            <span className="shrink-0 text-2xs text-ink-3">{STATUS_TEXT[file.status]}</span>
          </button>
        ))}
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {detailError ? (
          <Centered>{detailError}</Centered>
        ) : detail ? (
          <div className="py-2">
            <div className="flex items-center gap-2 px-3 pb-2">
              <span className="text-13 font-medium">{basenameOf(detail.path)}</span>
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
