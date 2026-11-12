// 浮层菜单共用样式（Select / DropdownMenu / ContextMenu），外观取自 beautiful-ui 的
// PromptBar 弹层：surface 底 + raised 阴影、10px 圆角、6px 选项圆角、pop-in 动效。
// 动效原点跟随 radix 的 transform-origin 变量（各组件自行设置 origin-*）。

export const menuPanel =
  'z-50 min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-card bg-surface p-1 text-ink shadow-raised animate-[pop-in_160ms_var(--ease-out-strong)_both]';

export const menuItem =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-chip px-2 text-13 text-ink outline-hidden transition-colors duration-100 focus:bg-hover data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-ink-3";

export const menuItemDestructive =
  'data-[variant=destructive]:text-red data-[variant=destructive]:focus:bg-red-tint data-[variant=destructive]:data-[highlighted]:bg-red-tint data-[variant=destructive]:*:[svg]:!text-red';
