import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../button';
import { Card } from '../card';
import { Collapsible, CollapsibleChevron } from '../collapsible';
import { IconButton } from '../icon-button';

/** 后台任务结束的通知行，展开后是任务带回的正文。 */
export function TaskNotice({
  icon: Icon,
  title,
  failed = false,
  label,
  duration,
  onOpenSession,
  children,
}: {
  icon: LucideIcon;
  title: string;
  failed?: boolean;
  label: string;
  duration: string;
  onOpenSession?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="my-3" variant="inset">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
        <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.8} />
        <span className={`shrink-0 font-medium ${failed ? 'text-danger' : ''}`}>{title}</span>
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums">{duration}</span>
        {onOpenSession && (
          <Button size="sm" variant="ghost" onClick={onOpenSession}>
            打开子会话
          </Button>
        )}
        <IconButton
          aria-expanded={open}
          aria-label={open ? '收起通知' : '展开通知'}
          className="size-6"
          onClick={() => setOpen((value) => !value)}
        >
          <CollapsibleChevron open={open} />
        </IconButton>
      </div>
      <Collapsible open={open}>{children}</Collapsible>
    </Card>
  );
}

/** 子 Agent 工具步骤的正文：任务说明、最终回复与进入子会话的入口。 */
export function SubagentCard({
  prompt,
  reply,
  footer,
}: {
  prompt?: string;
  reply?: ReactNode;
  footer?: { text: string; onOpen: () => void };
}) {
  return (
    <div className="mb-1 mt-1 grid min-w-0 gap-1.5">
      {prompt && (
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-ink-3">
          {prompt}
        </p>
      )}
      {reply && (
        <div className="max-h-80 overflow-y-auto rounded-card border border-line px-3 py-2 text-sm leading-6">
          {reply}
        </div>
      )}
      {footer && (
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <span>{footer.text}</span>
          <Button size="sm" variant="ghost" onClick={footer.onOpen}>
            打开子会话
          </Button>
        </div>
      )}
    </div>
  );
}
