import type { ComponentProps } from 'react';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { Button } from '../button';
import { cn } from '../lib/cn';

function ErrorCard({
  reason,
  onRetry,
  announce = true,
  className,
  ...props
}: ComponentProps<'div'> & {
  reason: string;
  onRetry?: () => void;
  /** 只有刚发生的错误才播报；历史消息里的失败不应在切换会话时被读出。 */
  announce?: boolean;
}) {
  return (
    <div
      role={announce ? 'alert' : undefined}
      className={cn(
        'my-3 flex items-start gap-2 rounded-card bg-danger-tint px-3 py-2 text-sm leading-6 text-ink',
        className,
      )}
      data-slot="error-card"
      {...props}
    >
      <CircleAlert aria-hidden className="mt-1 size-3.5 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 break-words">{reason}</p>
      {onRetry && (
        <Button
          className="-my-0.5 gap-1 hover:bg-surface"
          onClick={onRetry}
          size="sm"
          variant="ghost"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          重试
        </Button>
      )}
    </div>
  );
}

export { ErrorCard };
