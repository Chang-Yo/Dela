import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { SourceAvatar } from './source-stack';

type SourceItem = { key: string; url: string; title: string; label: string; snippet?: string };

function SourceList({
  items,
  className,
  ...props
}: ComponentProps<'ul'> & { items: SourceItem[] }) {
  return (
    <ul className={cn('grid min-w-0 gap-2.5', className)} data-slot="source-list" {...props}>
      {items.map((item) => (
        <li className="flex min-w-0 gap-2" key={item.key}>
          <SourceAvatar className="mt-0.5">{item.label}</SourceAvatar>
          <div className="min-w-0">
            <p className="flex min-w-0 items-baseline gap-2 text-sm">
              <a
                className="min-w-0 truncate text-ink hover:underline"
                href={item.url}
                rel="noreferrer"
                target="_blank"
                title={item.title}
              >
                {item.title}
              </a>
              <span className="shrink-0 text-xs text-ink-3">{item.label}</span>
            </p>
            {item.snippet && (
              <p className="line-clamp-2 text-xs leading-5 text-ink-3">{item.snippet}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export { SourceList, type SourceItem };
