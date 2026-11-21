'use client';

import { Fragment, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Collapsible, CollapsibleChevron } from '../collapsible';
import { fadeIn } from '../lib/motion';

function TraceToggle({
  open,
  className,
  children,
  ...props
}: ComponentProps<'button'> & { open: boolean }) {
  return (
    <button
      aria-expanded={open}
      className={cn(
        'group/row flex h-7 w-full min-w-0 items-center gap-1 text-left text-sm text-ink-3 transition-colors duration-base hover:text-ink-2 focus-visible:outline-none focus-visible:text-ink-2',
        className,
      )}
      // data-trace-toggle：消息列表据此在用户展开过程时暂停贴底跟随。
      data-trace-toggle
      type="button"
      {...props}
    >
      <CollapsibleChevron className="opacity-60 group-hover/row:opacity-100" open={open} />
      {children}
    </button>
  );
}

/** 一行可展开的步骤：思考、工具步骤与工具组共用。 */
function TraceDisclosure({
  head,
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { head: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('min-w-0', className)} data-slot="trace-disclosure" {...props}>
      <TraceToggle onClick={() => setOpen(!open)} open={open}>
        {head}
      </TraceToggle>
      <Collapsible className="ml-4.5" open={open}>
        <div className="min-w-0 pb-2">{children}</div>
      </Collapsible>
    </div>
  );
}

/**
 * 回复的过程块序列。给出 foldLabel 时，最后一块之外的过程块折进一行；
 * 过程块保持原位只是隐藏，最后一块在折叠前后是同一个节点。
 */
function Trace({
  blocks,
  foldLabel,
  className,
  ...props
}: ComponentProps<'div'> & {
  blocks: { key: number; node: ReactNode }[];
  foldLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const foldable = foldLabel !== undefined;
  const lastIndex = blocks.length - 1;
  return (
    <div aria-label="对话过程" className={cn('min-w-0', className)} data-slot="trace" {...props}>
      {foldable && (
        <TraceToggle className="mb-1" onClick={() => setExpanded(!expanded)} open={expanded}>
          <span className="min-w-0 truncate">{foldLabel}</span>
        </TraceToggle>
      )}
      {blocks.map(({ key, node }, index) =>
        foldable && index < lastIndex ? (
          <div
            key={key}
            hidden={!expanded}
            className={cn(fadeIn, 'ml-1.75 border-l border-line pl-2.75')}
          >
            {node}
          </div>
        ) : (
          <Fragment key={key}>{node}</Fragment>
        ),
      )}
    </div>
  );
}

export { Trace, TraceDisclosure };
