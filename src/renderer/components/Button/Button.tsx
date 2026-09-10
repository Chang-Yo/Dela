import clsx from 'clsx';
import type { ComponentProps } from 'react';
import styles from './Button.module.css';

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'quiet' | 'text';
  size?: 'md' | 'sm';
};

export function Button({ variant = 'quiet', size = 'md', className, type, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(styles[variant], size === 'sm' && styles.sm, className)}
      type={type ?? 'button'}
      {...props}
    />
  );
}
