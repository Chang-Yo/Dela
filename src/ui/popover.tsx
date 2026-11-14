import { Popover as PopoverPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from './cn';
import { menuPanel } from './menu-styles';

// 面板外观与菜单一致；列表类内容沿用 p-1，说明、表单类内容由调用方换成 px-3 py-2.5 等。

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/** 浮层定位在别的元素上、由代码控制开合时使用（如悬停卡片上的编辑浮层）。 */
function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverClose({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className={cn(
          menuPanel,
          'max-h-(--radix-popover-content-available-height) max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin)',
          className,
        )}
        collisionPadding={collisionPadding}
        data-slot="popover-content"
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger };
