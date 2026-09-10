import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, actions, className }: PageHeaderProps) {
  return (
    <header className={clsx(styles.pageHeader, className)}>
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}
