'use client';

import { Button } from '../button';
import { cn } from '../lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { ProgressRing } from '../progress-ring';

type ContextIndicatorUsage = {
  tokens: number | null;
  estimated?: boolean;
  contextWindow: number;
  percent: number | null;
};

function formatTokens(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`;
}

function usageTone(percent: number | null): 'neutral' | 'warning' | 'danger' {
  if (percent === null) return 'neutral';
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warning';
  return 'neutral';
}

const barColors = { neutral: 'bg-ink-2', warning: 'bg-warning', danger: 'bg-danger' };

function ContextIndicator({
  usage,
  cacheHitLabel,
  cacheHitRate,
}: {
  usage: ContextIndicatorUsage;
  cacheHitLabel: string;
  cacheHitRate: string;
}) {
  const tone = usageTone(usage.percent);
  const percentText = usage.percent === null ? null : usage.percent.toFixed(1).replace(/\.0$/, '');
  const triggerLabel = percentText === null ? '上下文占用' : `上下文占用 ${percentText}%`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={triggerLabel}
          data-slot="context-indicator"
          size="icon-sm"
          title={triggerLabel}
          variant="ghost"
        >
          <ProgressRing progress={(usage.percent ?? 0) / 100} size={18} tone={tone} />
        </Button>
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
            {percentText !== null && ` (${percentText}%)`}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-field">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-slower ease-out-strong',
              barColors[tone],
            )}
            style={{ width: `${Math.min(100, usage.percent ?? 0)}%` }}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-2">{cacheHitLabel}</span>
          <span className="text-xs tabular-nums text-ink-3">{cacheHitRate}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { ContextIndicator, type ContextIndicatorUsage };
