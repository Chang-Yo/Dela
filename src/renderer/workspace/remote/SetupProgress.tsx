// 连接一台服务器时的过程展示：上面一排步骤标签（探测 → 校验 → 上传 → 启动 → 隧道 → 握手），
// 上传时一条真实的字节进度条，下面是逐行日志（默认展开，可折叠）。失败时标题说清楚卡在哪，
// 并给出「重试 / 编辑连接」。产物已在服务器上时整个过程一两秒，不会出现上传那一步。
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { RemoteSetupProgress, RemoteSetupStep } from '../../../shared/api';

const stepLabels: Record<RemoteSetupStep, string> = {
  probe: '探测',
  verify: '校验',
  upload: '上传',
  start: '启动',
  tunnel: '隧道',
  handshake: '握手',
  ready: '就绪',
};

/** 标签栏只放有意义的几步；ready 是收尾，不单独占一格。 */
const visibleSteps: RemoteSetupStep[] = [
  'probe',
  'verify',
  'upload',
  'start',
  'tunnel',
  'handshake',
];

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

function statusOf(log: RemoteSetupProgress[], step: RemoteSetupStep, done: boolean): StepStatus {
  const lines = log.filter((line) => line.step === step);
  if (lines.some((line) => line.ok === false)) return 'failed';
  if (lines.some((line) => line.ok === true)) return 'done';
  if (lines.length) return 'running';
  // 校验命中时不会上传：后面的步骤开始了它还没出现过，就是跳过了。
  const index = visibleSteps.indexOf(step);
  const later = visibleSteps
    .slice(index + 1)
    .some((next) => log.some((line) => line.step === next));
  return later || done ? 'skipped' : 'pending';
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** 失败标题：按卡住的那一步说人话，原因放在下一行原样给出。 */
function failureTitle(step: RemoteSetupStep | undefined): string {
  switch (step) {
    case 'probe':
      return '无法通过 SSH 连上这台服务器';
    case 'verify':
    case 'upload':
      return '无法把 helper 放到服务器上';
    case 'start':
      return '无法在这台服务器上启动 helper';
    case 'tunnel':
    case 'handshake':
      return '无法与服务器上的 helper 建立通道';
    default:
      return '连接失败';
  }
}

export function SetupProgress({
  log,
  running,
  failure,
  onRetry,
  onEdit,
}: {
  log: RemoteSetupProgress[];
  running: boolean;
  /** 失败原因；null 表示没失败（或还在跑）。 */
  failure: string | null;
  onRetry: () => void;
  onEdit?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const logRef = useRef<HTMLDivElement | null>(null);
  const done = !running;
  const failedLine = log.findLast((line) => line.ok === false);
  const upload = log.findLast((line) => line.step === 'upload' && line.bytes);
  const uploading = upload?.bytes && upload.ok === undefined && running;
  // 进度更新是同一步的重复行：日志里只留开始与结束，不刷几十行百分比。
  const lines = log.filter((line) => !(line.step === 'upload' && line.bytes && !line.detail));

  // 新行进来就贴底：日志区固定高度，阅读位置跟着输出往前走。
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines.length]);

  return (
    <div className="grid gap-3 rounded-card border border-line bg-field p-3.5">
      {failure ? (
        <div className="grid gap-1" role="alert">
          <p className="flex items-center gap-1.5 text-13 font-medium text-red">
            <X className="size-4 shrink-0" />
            {failureTitle(failedLine?.step)}
          </p>
          <p className="pl-5.5 text-xs leading-relaxed [overflow-wrap:anywhere] text-ink-2">
            {failure}
          </p>
          <div className="flex gap-2 pt-1.5 pl-5.5">
            <Button onClick={onRetry} size="sm" type="button" variant="secondary">
              重试
            </Button>
            {onEdit && (
              <Button onClick={onEdit} size="sm" type="button" variant="ghost">
                编辑连接
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-13 font-medium text-ink" role="status">
          {running ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-ink-3" />
          ) : (
            <Check className="size-4 shrink-0 text-green" />
          )}
          {running
            ? log.some((line) => line.step === 'upload')
              ? '正在准备远端环境（仅首次）'
              : '正在连接…'
            : '已连接'}
        </p>
      )}

      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {visibleSteps.map((step) => {
          const status = statusOf(log, step, done && !failure);
          if (status === 'skipped' && step === 'upload') return null;
          return (
            <li
              className={cn(
                'flex items-center gap-1',
                status === 'pending' && 'text-ink-3/60',
                status === 'running' && 'font-medium text-ink',
                status === 'done' && 'text-ink-2',
                status === 'skipped' && 'text-ink-3/60',
                status === 'failed' && 'font-medium text-red',
              )}
              key={step}
            >
              {status === 'done' || status === 'skipped' ? (
                <Check className="size-3 text-green" aria-hidden="true" />
              ) : status === 'failed' ? (
                <X className="size-3" aria-hidden="true" />
              ) : status === 'running' ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full bg-orange motion-reduce:animate-none"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full border border-line-strong"
                />
              )}
              {stepLabels[step]}
            </li>
          );
        })}
      </ol>

      {uploading && upload.bytes && (
        <div className="grid gap-1">
          <div
            aria-label="上传 helper"
            aria-valuemax={upload.bytes.total}
            aria-valuemin={0}
            aria-valuenow={upload.bytes.sent}
            className="h-1.5 overflow-hidden rounded-full bg-line"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-ink-2 transition-[width] duration-200"
              style={{ width: `${(upload.bytes.sent / upload.bytes.total) * 100}%` }}
            />
          </div>
          <p className="text-right text-2xs tabular-nums text-ink-3">
            {formatBytes(upload.bytes.sent)} / {formatBytes(upload.bytes.total)}
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <button
          aria-expanded={expanded}
          className="flex w-fit items-center gap-1 text-xs text-ink-3 transition-colors duration-150 hover:text-ink-2"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform duration-150 motion-reduce:transition-none',
              !expanded && '-rotate-90',
            )}
          />
          详细日志
        </button>
        {expanded && (
          <div
            className="grid max-h-36 content-start gap-0.5 overflow-y-auto rounded-control bg-surface px-2.5 py-2 font-mono text-2xs leading-[1.7]"
            ref={logRef}
            role="log"
          >
            {lines.length === 0 ? (
              <p className="text-ink-3">等待服务器响应…</p>
            ) : (
              lines.map((line, index) => (
                <p
                  className={cn('flex min-w-0 gap-2', line.ok === false && 'text-red')}
                  key={`${index}-${line.step}`}
                >
                  <span className="w-7 shrink-0 text-ink-3">{stepLabels[line.step]}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere] text-ink-2">
                    {line.ok === false ? '✕ ' : line.ok ? '✓ ' : ''}
                    {line.detail}
                    {line.bytes && line.detail ? ` · ${formatBytes(line.bytes.total)}` : ''}
                  </span>
                </p>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
