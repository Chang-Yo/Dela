import { Select as SelectPrimitive } from 'radix-ui';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../../lib/utils';
import { menuItem, menuPanel } from './menu-styles';

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-8 w-fit min-w-0 max-w-full items-center justify-between gap-1.5 whitespace-nowrap rounded-control bg-field px-2.5 text-13 font-medium text-ink shadow-hairline outline-none transition-[background-color,box-shadow] duration-150 hover:shadow-[0_0_0_1px_var(--line-strong)] data-[state=open]:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bui-accent disabled:pointer-events-none disabled:opacity-50 data-[placeholder]:text-ink-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5 *:data-[slot=select-value]:truncate',
        className,
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <ChevronDownIcon className="size-3.5 text-ink-3" />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          menuPanel,
          'relative max-h-(--radix-select-content-available-height) max-w-(--radix-select-content-available-width) origin-(--radix-select-content-transform-origin)',
          className,
        )}
        data-slot="select-content"
        position={position}
        sideOffset={4}
        {...props}
      >
        {children}
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        // 左右内边距对称：选中指示器是绝对定位的，不需要再为它预留右侧内边距
        // （原 pr-8 会让高亮块右内边距远大于左侧）。Radix 会丢弃 ItemText 上的 className，
        // 截断与指示器避让只能挂在条目上选中末位的 ItemText span。
        menuItem,
        'w-full [&>*:last-child]:truncate [&>*:last-child]:pe-6',
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5 text-ink" strokeWidth={2.5} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
