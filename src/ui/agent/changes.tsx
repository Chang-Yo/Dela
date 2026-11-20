'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../button';
import { Card } from '../card';
import { cn } from '../lib/cn';
import { Collapse, CollapseChevron } from '../collapse';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu';
import { FileIcon } from '../file-icon';

export type DiffCounts = { added: number; deleted: number };

function DiffCountsLabel({ counts, className }: { counts: DiffCounts; className?: string }) {
  return (
    <span className={cn('flex gap-1.5 font-mono text-xs', className)}>
      {counts.added > 0 && <span className="text-success">+{counts.added}</span>}
      {counts.deleted > 0 && <span className="text-danger">-{counts.deleted}</span>}
    </span>
  );
}

/** 回答末尾的「本轮改动」卡片：默认折叠，防止大轮次刷屏；children 是 ChangedFile 列表。 */
export function ChangesCard({
  fileCount,
  counts,
  warning,
  children,
}: {
  fileCount: number;
  counts?: DiffCounts;
  warning?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card asChild>
      <section aria-label="本轮改动" className="mt-3 text-sm">
        <button
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors duration-base hover:bg-hover"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <CollapseChevron className="text-ink-3" open={open} />
          <span className="shrink-0 text-xs text-ink-3">本轮改动 · {fileCount} 个文件</span>
          {counts && <DiffCountsLabel className="min-w-0" counts={counts} />}
        </button>
        <Collapse open={open}>
          <ul className="grid border-t border-line">{children}</ul>
          {warning && (
            <p className="border-t border-line px-3 py-2 text-xs leading-5 text-ink-3">{warning}</p>
          )}
        </Collapse>
      </section>
    </Card>
  );
}

export function ChangedFile({
  path,
  name,
  directory,
  counts,
  deleted,
  onReview,
  onOpen,
  openWith,
}: {
  path: string;
  name: string;
  directory: string;
  counts?: DiffCounts;
  deleted: boolean;
  onReview?: () => void;
  onOpen: () => void;
  openWith: { key: string; icon: ReactNode; label: string; onSelect: () => void }[];
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-1.5" data-turn-file={path}>
      <FileIcon path={path} />
      <span className="shrink-0 truncate text-sm" title={path}>
        {name}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-ink-3" title={path}>
        {directory}
      </span>
      {counts && <DiffCountsLabel className="shrink-0" counts={counts} />}
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
          title={deleted ? '文件已删除' : '在 Dela 中打开'}
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
