// 侧栏与标题栏共用样式（beautiful-ui token）。层级：
// - 一级行（首页/资料/业务入口/项目/设置）：13px ink-2，选中 hover-2 底 + ink + medium；
// - 二级行（会话）：12.5px ink-3，选中同底色、文字回到 ink；
// - 分组标题：11.5px ink-3 medium；
// - 图标按钮：28px（标题栏）/ 24px（行内悬浮），ink-3 → hover ink。
import { cn } from '../lib/utils';

export const navRow = (active: boolean) =>
  cn(
    'flex h-8 min-w-0 items-center gap-2.5 rounded-control px-2 text-left text-[13px] transition-colors duration-150',
    active ? 'bg-hover-2 font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
  );

export const navIcon = (active: boolean) =>
  cn('size-4 shrink-0', active ? 'text-ink' : 'text-ink-3');

export const navSubRow = (active: boolean) =>
  cn(
    'group relative flex h-7 min-w-0 items-center rounded-control pl-8 pr-1.5 transition-colors duration-150',
    active ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink-2',
  );

export const navSectionTitle = 'px-2 pb-1 text-[11.5px] font-medium text-ink-3';

/** 标题栏与侧栏头部的图标按钮。 */
export const chromeIconButton =
  'grid size-7 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 aria-[current=page]:bg-hover-2 aria-[current=page]:text-ink';

/** 行内悬浮出现的小图标按钮（项目菜单、新对话、置顶、归档）。 */
export const rowIconButton =
  'grid size-6 shrink-0 place-items-center rounded-chip text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink [&_svg]:size-3.5';

/** 行尾悬浮操作区：底色跟随行状态，盖住被截断的标题尾部。 */
export const rowActions =
  'pointer-events-none absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 max-md:pointer-events-auto max-md:opacity-100';
