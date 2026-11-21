import { Select as SelectPrimitive } from 'radix-ui';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from './lib/cn';
import { fieldTrigger, menuItem, menuPanel } from './lib/menu-styles';

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

const triggerSizes = {
  md: '',
  lg: 'h-10 rounded-card px-3',
} as const;

function SelectTrigger({
  className,
  children,
  size = 'md',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: keyof typeof triggerSizes }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        fieldTrigger,
        'data-[placeholder]:text-ink-3 *:data-[slot=select-value]:truncate',
        triggerSizes[size],
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
          'relative min-w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height) max-w-(--radix-select-content-available-width) origin-(--radix-select-content-transform-origin)',
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
        // Radix 会丢弃 ItemText 上的 className，截断与指示器避让只能挂在条目上选中末位的 ItemText span。
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
