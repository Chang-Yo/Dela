import type { ComponentProps } from 'react';
import { ArrowLeft, Bot, Square } from 'lucide-react';
import { Badge } from '../badge';
import { Button } from '../button';
import { cn } from '../lib/cn';

type SubagentStatus = 'running' | 'completed' | 'failed' | 'stopped';

const STATUS = {
  running: { label: '运行中', tone: 'accent' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  stopped: { label: '已停止', tone: 'neutral' },
} as const;

function SubagentBanner({
  title,
  status,
  backLabel,
  onBack,
  onStop,
  className,
  ...props
}: ComponentProps<'div'> & {
  title: string;
  status: SubagentStatus;
  backLabel: string;
  onBack: () => void;
  onStop?: () => void;
}) {
  return (
    <div
      className={cn('flex min-w-0 items-center gap-2', className)}
      data-slot="subagent-banner"
      {...props}
    >
      <Button className="-ml-2 shrink-0" onClick={onBack} size="sm" variant="ghost">
        <ArrowLeft />
        {backLabel}
      </Button>
      <span aria-hidden className="text-ink-3 select-none">
        /
      </span>
      <Bot aria-hidden className="size-4 shrink-0 text-ink-3" />
      <span className="min-w-0 truncate text-sm font-medium text-ink" title={title}>
        {title}
      </span>
      <Badge className="shrink-0" size="2xs" tone={STATUS[status].tone}>
        {STATUS[status].label}
      </Badge>
      {status === 'running' && onStop && (
        <Button className="ml-auto shrink-0" onClick={onStop} size="sm" variant="outline">
          <Square />
          停止
        </Button>
      )}
    </div>
  );
}

export { SubagentBanner, type SubagentStatus };
