import { useState, type ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../button';
import { Card } from '../card';
import { Collapsible, CollapsibleChevron } from '../collapsible';
import { cn } from '../lib/cn';

/** 后台任务结束的通知行，展开后是任务带回的正文。 */
function TaskNotice({
  icon: Icon,
  title,
  failed = false,
  label,
  duration,
  onOpenSession,
  children,
  className,
  ...props
}: ComponentProps<'div'> & {
  icon: LucideIcon;
  title: string;
  failed?: boolean;
  label: string;
  duration: string;
  onOpenSession?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={cn('my-3', className)} data-slot="task-notice" variant="inset" {...props}>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
        <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.8} />
        <span className={cn('shrink-0 font-medium', failed && 'text-danger')}>{title}</span>
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums">{duration}</span>
        {onOpenSession && (
          <Button size="sm" variant="ghost" onClick={onOpenSession}>
            打开子会话
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={open}
          aria-label={open ? '收起通知' : '展开通知'}
          className="size-6"
          onClick={() => setOpen((value) => !value)}
        >
          <CollapsibleChevron open={open} />
        </Button>
      </div>
      <Collapsible open={open}>{children}</Collapsible>
    </Card>
  );
}

export { TaskNotice };
