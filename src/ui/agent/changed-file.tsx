import type { ComponentProps, ReactNode } from 'react';
import { Button } from '../button';
import { cn } from '../lib/cn';
import { DropdownMenuItem } from '../dropdown-menu';
import { FileIcon } from '../file-icon';
import { SplitButton, SplitButtonAction, SplitButtonMenu } from '../split-button';
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
      <SplitButton>
        <SplitButtonAction
          disabled={deleted}
          onClick={onOpen}
          size="sm"
          title={deleted ? '文件已删除' : openTitle}
        >
          打开
        </SplitButtonAction>
        <SplitButtonMenu disabled={deleted} label="选择打开方式">
          {openWith.map(({ key, icon, label, onSelect }) => (
            <DropdownMenuItem key={key} onSelect={onSelect}>
              {icon}
              {label}
            </DropdownMenuItem>
          ))}
        </SplitButtonMenu>
      </SplitButton>
    </li>
  );
}

export { ChangedFile };
