// 连接一台服务器时的过程展示：步骤标签、上传字节进度条与逐行日志；失败时标题说清卡在哪一步。
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/lib/cn';
import { Collapse, CollapseChevron } from '../../../ui/collapsible';
import type { RemoteSetupProgress, RemoteSetupStep } from '../contract';
import { Spinner } from '../../../ui/spinner';

const stepLabels: Record<RemoteSetupStep, string> = {
  probe: '探测',
  verify: '校验',
  upload: '上传',
  start: '启动',
  tunnel: '隧道',
  handshake: '握手',
  ready: '就绪',
};

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

/** 每来一行新日志，末尾锚点重新挂载，借此把阅读位置贴到底。 */
const stickToBottom = (anchor: HTMLElement | null) => {
  if (anchor?.parentElement) anchor.parentElement.scrollTop = anchor.parentElement.scrollHeight;
};

export function SetupProgress({
  log,
  running,
  failure,
  onRetry,
  onEdit,
}: {
  log: RemoteSetupProgress[];
  running: boolean;
  failure: string | null;
  onRetry: () => void;
  onEdit?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const done = !running;
  const failedLine = log.findLast((line) => line.ok === false);
  const upload = log.findLast((line) => line.step === 'upload' && line.bytes);
  const uploading = upload?.bytes && upload.ok === undefined && running;
  // 进度更新是同一步的重复行：日志里只留开始与结束，不刷几十行百分比。
  const lines = log.filter((line) => !(line.step === 'upload' && line.bytes && !line.detail));

  return (
    <div className="grid gap-3 rounded-card border border-line bg-field p-3.5">
      {failure ? (
        <div className="grid gap-1" role="alert">
          <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
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
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink" role="status">
          {running ? (
            <Spinner className="shrink-0 text-ink-3" />
          ) : (
            <Check className="size-4 shrink-0 text-success" />
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
                status === 'failed' && 'font-medium text-danger',
              )}
              key={step}
            >
              {status === 'done' || status === 'skipped' ? (
                <Check className="size-3 text-success" aria-hidden="true" />
              ) : status === 'failed' ? (
                <X className="size-3" aria-hidden="true" />
              ) : status === 'running' ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full bg-warning motion-reduce:animate-none"
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
              className="h-full rounded-full bg-ink-2 transition-[width] duration-slow"
              style={{ width: `${(upload.bytes.sent / upload.bytes.total) * 100}%` }}
            />
          </div>
          <p className="text-right text-xs tabular-nums text-ink-3">
            {formatBytes(upload.bytes.sent)} / {formatBytes(upload.bytes.total)}
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <button
          aria-expanded={expanded}
          className="flex w-fit items-center gap-1 text-xs text-ink-3 transition-colors duration-base hover:text-ink-2"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <CollapseChevron open={expanded} />
          详细日志
        </button>
        <Collapse open={expanded}>
          <div
            className="grid max-h-36 content-start gap-0.5 overflow-y-auto rounded-control bg-surface px-2.5 py-2 font-mono text-xs leading-[1.7]"
            role="log"
          >
            {lines.length === 0 ? (
              <p className="text-ink-3">等待服务器响应…</p>
            ) : (
              lines.map((line, index) => (
                <p
                  className={cn('flex min-w-0 gap-2', line.ok === false && 'text-danger')}
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
            <span aria-hidden="true" className="absolute" key={lines.length} ref={stickToBottom} />
          </div>
        </Collapse>
      </div>
    </div>
  );
}
