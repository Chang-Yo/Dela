import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { Shimmer } from '../shimmer';
import { TraceDisclosure } from './trace';

/** 思考过程：进行态只显示动画标题，展开后是原始思考文本。 */
function Reasoning({
  live,
  children,
  className,
  ...props
}: ComponentProps<'div'> & { live: boolean }) {
  return (
    <div className={cn('my-1', className)} data-slot="reasoning" {...props}>
      <TraceDisclosure head={live ? <Shimmer>正在思考</Shimmer> : <span>思考过程</span>}>
        <div
          data-reasoning-body
          className="max-h-72 overflow-y-auto border-l border-line pl-3 text-sm leading-6 whitespace-pre-wrap text-ink-3"
        >
          {children}
        </div>
      </TraceDisclosure>
    </div>
  );
}

export { Reasoning };
