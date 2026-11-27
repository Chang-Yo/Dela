import { ChevronDown } from 'lucide-react';
import type * as React from 'react';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu';
import { cn } from './lib/cn';

function SplitButton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex h-7 shrink-0 items-center rounded-control shadow-hairline', className)}
      data-slot="split-button"
      {...props}
    />
  );
}

function SplitButtonAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn('rounded-r-none active:scale-100', className)}
      data-slot="split-button-action"
      variant="ghost"
      {...props}
    />
  );
}

function SplitButtonMenu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={label}
          className="grid h-full w-5 place-items-center rounded-r-control border-l border-line text-ink-3 outline-none transition-colors duration-base hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-selected"
          data-slot="split-button-menu"
          disabled={disabled}
          title={label}
          type="button"
        >
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export { SplitButton, SplitButtonAction, SplitButtonMenu };
