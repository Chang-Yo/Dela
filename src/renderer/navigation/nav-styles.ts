// 侧栏与标题栏共用样式（beautiful-ui token）。
import { cn } from '../lib/utils';

export const navRow = (active: boolean) =>
  cn(
    'flex h-8 min-w-0 items-center gap-2.5 rounded-control px-2 text-left text-13 transition-colors duration-150',
    active ? 'bg-hover-2 font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
  );

export const navIcon = (active: boolean) =>
  cn('size-4 shrink-0', active ? 'text-ink' : 'text-ink-3');

export const navSubRow = (active: boolean) =>
  cn(
    'group relative flex h-7 min-w-0 items-center rounded-control pl-8 pr-1.5 transition-colors duration-150',
    active ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink-2',
  );

export const navSectionTitle = 'px-2 pb-1 text-xs font-medium text-ink-3';

export const chromeIconButton =
  'grid size-7 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 aria-[current=page]:bg-hover-2 aria-[current=page]:text-ink';

export const rowIconButton =
  'grid size-6 shrink-0 place-items-center rounded-chip text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink [&_svg]:size-3.5';

/** 行尾悬浮操作区：盖住被截断的标题尾部。 */
export const rowActions =
  'pointer-events-none absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 max-md:pointer-events-auto max-md:opacity-100';
