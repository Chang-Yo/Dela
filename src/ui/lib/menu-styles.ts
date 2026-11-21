export const menuPanel =
  'z-overlay min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-card bg-surface p-1 text-ink shadow-raised animate-pop-in';

/** 点开浮层来选值的输入控件：下拉框、日期与时间选择器共用这一外观。 */
export const fieldTrigger =
  'flex h-8 w-fit min-w-0 max-w-full items-center justify-between gap-1.5 whitespace-nowrap rounded-control bg-field px-2.5 text-sm font-medium text-ink shadow-hairline outline-none transition-[background-color,box-shadow] duration-base hover:shadow-hairline-strong data-[state=open]:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5';

export const menuItem =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-chip px-2 text-sm text-ink outline-hidden transition-colors duration-fast focus:bg-hover data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-ink-3";

export const menuItemDestructive =
  'data-[variant=destructive]:text-danger data-[variant=destructive]:focus:bg-danger-tint data-[variant=destructive]:data-[highlighted]:bg-danger-tint data-[variant=destructive]:*:[svg]:!text-danger';
