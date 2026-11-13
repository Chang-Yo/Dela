import { Slot } from 'radix-ui';
import { useId } from 'react';
import type * as React from 'react';
import { ErrorText } from './alert';
import { cn } from './cn';

type FieldProps = Omit<React.ComponentProps<'label'>, 'children'> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
};

/* 标签包住控件：点标签即聚焦，且 Select 等无法接收 id 的控件也适用；有 error 时单控件会带上 aria-invalid。 */
function Field({ label, hint, error, children, className, ...props }: FieldProps) {
  const errorId = useId();
  return (
    <label className={cn('grid gap-2 text-sm', className)} data-slot="field" {...props}>
      {label}
      {error ? (
        <Slot.Root aria-describedby={errorId} aria-invalid>
          {children}
        </Slot.Root>
      ) : (
        children
      )}
      {hint ? <span className="text-xs leading-relaxed text-ink-3">{hint}</span> : null}
      {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
    </label>
  );
}

export { Field };
