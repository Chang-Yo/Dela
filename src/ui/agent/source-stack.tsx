import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

type Source = { key: string; label: string };

/** 一叠来源头像（取站点名首字），只作点缀：数量由旁边的文字说明，读屏跳过。 */
function SourceStack({
  sources,
  max = 4,
  className,
  ...props
}: ComponentProps<'span'> & { sources: Source[]; max?: number }) {
  const rest = sources.length - max;
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center', className)}
      data-slot="source-stack"
      {...props}
    >
      {sources.slice(0, max).map((source) => (
        <SourceAvatar className="-ml-1.5 ring-2 ring-surface first:ml-0" key={source.key}>
          {source.label}
        </SourceAvatar>
      ))}
      {rest > 0 && <span className="ml-1 text-xs text-ink-3">+{rest}</span>}
    </span>
  );
}

function SourceAvatar({
  children,
  className,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { children: string }) {
  return (
    <span
      className={cn(
        'flex size-4.5 shrink-0 items-center justify-center rounded-full bg-fill text-xs leading-none font-medium text-ink-2 uppercase',
        className,
      )}
      data-slot="source-avatar"
      {...props}
    >
      {Array.from(children.replace(/^www\./, ''))[0] ?? '?'}
    </span>
  );
}

export { SourceStack, SourceAvatar, type Source };
