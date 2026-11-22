import type { ComponentProps, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../button';
import { cn } from '../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu';
import { FileIcon } from '../file-icon';
import { DiffStat, type DiffCounts } from './diff-stat';

function ChangedFile({
  path,
  name,
  directory,
  counts,
  deleted,
  onReview,
  onOpen,
  openTitle,
  openWith,
  className,
  ...props
}: ComponentProps<'li'> & {
  path: string;
  name: string;
  directory: string;
  counts?: DiffCounts;
  deleted: boolean;
  onReview?: () => void;
  onOpen: () => void;
  openTitle: string;
  openWith: { key: string; icon: ReactNode; label: string; onSelect: () => void }[];
}) {
  return (
    <li
      className={cn('flex min-w-0 items-center gap-2 px-3 py-1.5', className)}
      data-slot="changed-file"
      data-turn-file={path}
      {...props}
    >
      <FileIcon path={path} />
      <span className="min-w-0 truncate text-sm" title={path}>
        {name}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-ink-3" title={path}>
        {directory}
      </span>
      {counts && <DiffStat className="shrink-0" counts={counts} hideZero />}
      {onReview && (
        <Button className="shrink-0" onClick={onReview} size="sm" type="button" variant="outline">
          审阅
        </Button>
      )}
      <div className="flex h-7 shrink-0 items-center rounded-control shadow-hairline">
        <button
          className="grid h-full place-items-center rounded-l-control px-2.5 text-xs font-medium text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          disabled={deleted}
          onClick={onOpen}
          title={deleted ? '文件已删除' : openTitle}
          type="button"
        >
          打开
        </button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="选择打开方式"
              className="grid h-full w-5 place-items-center rounded-r-control border-l border-line text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-50"
              disabled={deleted}
              title="选择打开方式"
              type="button"
            >
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {openWith.map(({ key, icon, label, onSelect }) => (
              <DropdownMenuItem key={key} onSelect={onSelect}>
                {icon}
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export { ChangedFile };
