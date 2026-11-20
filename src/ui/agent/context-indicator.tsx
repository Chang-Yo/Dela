'use client';

import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { ProgressRing } from '../progress-ring';

export type ContextIndicatorUsage = {
  tokens: number | null;
  estimated?: boolean;
  contextWindow: number;
  percent: number | null;
};

function formatTokens(tokens: number): string {
  return tokens < 1000 ? '0K' : `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`;
}

function usageTone(percent: number | null): 'neutral' | 'warning' | 'danger' {
  if (percent === null) return 'neutral';
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warning';
  return 'neutral';
}

export function ContextIndicator({
  usage,
  cacheHitRate,
}: {
  usage: ContextIndicatorUsage;
  cacheHitRate: string;
}) {
  const tone = usageTone(usage.percent);
  const color =
    tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--ink-2)';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="上下文占用"
          className="flex size-7 shrink-0 items-center justify-center rounded-control transition-colors duration-base hover:bg-hover"
          title="上下文占用"
          type="button"
        >
          <ProgressRing progress={(usage.percent ?? 0) / 100} size={18} tone={tone} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        aria-label="上下文占用"
        className="w-60 px-3 py-2.5"
        side="top"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-ink">上下文</span>
          <span className="text-xs tabular-nums text-ink-3">
            {usage.tokens === null
              ? '—'
              : `${usage.estimated ? '约 ' : ''}${formatTokens(usage.tokens)}`}{' '}
            / {formatTokens(usage.contextWindow)}
            {usage.percent !== null && ` (${usage.percent.toFixed(1).replace(/\.0$/, '')}%)`}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-field">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, usage.percent ?? 0)}%`,
              background: color,
              transition: 'width 400ms cubic-bezier(0.23,1,0.32,1)',
            }}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-2">缓存命中率</span>
          <span className="text-xs tabular-nums text-ink-3">{cacheHitRate}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
