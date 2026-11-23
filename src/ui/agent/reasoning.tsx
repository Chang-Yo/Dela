import type { ComponentProps } from 'react';
import { Brain } from 'lucide-react';
import { cn } from '../lib/cn';
import { Shimmer } from '../shimmer';
import { TraceDisclosure } from './trace';

function Reasoning({
  live,
  label = '思考过程',
  children,
  className,
  ...props
}: ComponentProps<'div'> & { live: boolean; label?: string }) {
  return (
    <div className={cn('my-1', className)} data-slot="reasoning" {...props}>
      <TraceDisclosure
        head={live ? <Shimmer>正在思考</Shimmer> : <span className="truncate">{label}</span>}
        icon={<Brain />}
      >
        <div
          data-reasoning-body
          className="max-h-72 overflow-y-auto text-sm leading-6 whitespace-pre-wrap text-ink-2"
        >
          {children}
        </div>
      </TraceDisclosure>
    </div>
  );
}

export { Reasoning };
