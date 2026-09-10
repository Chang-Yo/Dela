import clsx from 'clsx';
import styles from './StatusDot.module.css';

type StatusDotProps = {
  tone?: 'amber' | 'green' | 'blue' | 'success';
  size?: 'md' | 'sm' | 'xs';
  glow?: boolean;
};

export function StatusDot({ tone = 'success', size = 'md', glow = false }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={clsx(styles.dot, styles[tone], styles[size], glow && styles.glow)}
    />
  );
}
