import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { CheckIcon, CircleIcon } from 'lucide-react';
import { useRef } from 'react';
import type * as React from 'react';
import { cn } from '../../lib/utils';
import { menuItem, menuItemDestructive, menuPanel } from './menu-styles';

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          menuPanel,
          'max-h-(--radix-dropdown-menu-content-available-height) max-w-(--radix-dropdown-menu-content-available-width) origin-(--radix-dropdown-menu-content-transform-origin)',
          className,
        )}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(menuItem, menuItemDestructive, 'data-[inset]:pl-8', className)}
      data-inset={inset}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(menuItem, 'pl-8', className)}
      data-slot="dropdown-menu-checkbox-item"
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5 text-ink" strokeWidth={2.5} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(menuItem, 'pl-8', className)}
      data-slot="dropdown-menu-radio-item"
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2 pt-1.5 pb-1 text-xs font-medium text-ink-3 data-[inset]:pl-8', className)}
      data-inset={inset}
      data-slot="dropdown-menu-label"
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-line', className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-ink-3', className)}
      data-slot="dropdown-menu-shortcut"
      {...props}
    />
  );
}

/** 菜单项要把焦点交给菜单外新出现的元素（如行内新建的名称输入框）时用：菜单关闭会把焦点还给
 * 触发按钮，抢走新元素的焦点。defer 记下动作，等菜单关完（onCloseAutoFocus）再执行，并取消这次焦点回收。 */
function useAfterMenuClose() {
  const pending = useRef<(() => void) | null>(null);
  return {
    defer: (action: () => void) => {
      pending.current = action;
    },
    onCloseAutoFocus: (event: Event) => {
      const action = pending.current;
      if (!action) return;
      pending.current = null;
      event.preventDefault();
      action();
    },
  };
}

export {
  useAfterMenuClose,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
};
