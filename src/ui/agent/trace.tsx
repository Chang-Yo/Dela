'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Collapse, CollapseChevron } from '../collapsible';
import { fadeIn } from '../lib/motion';

const toggleClass =
  'group/row flex h-7 w-full min-w-0 items-center gap-1 text-left text-sm text-ink-3 transition-colors duration-base hover:text-ink-2 focus-visible:outline-none focus-visible:text-ink-2';

/** 一行可展开的步骤：思考、工具步骤与工具组共用。 */
export function TraceDisclosure({ head, children }: { head: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        // data-trace-toggle：消息列表据此在用户展开过程时暂停贴底跟随。
        data-trace-toggle
        onClick={() => setOpen(!open)}
        className={toggleClass}
      >
        <CollapseChevron className="opacity-60 group-hover/row:opacity-100" open={open} />
        {head}
      </button>
      <Collapse className="ml-[1.125rem]" open={open}>
        <div className="min-w-0 pb-2">{children}</div>
      </Collapse>
    </div>
  );
}

/**
 * 回复的过程块序列。给出 foldLabel 时，最后一块之外的过程块折进一行；
 * 过程块保持原位只是隐藏，最后一块在折叠前后是同一个节点。
 */
export function Trace({
  blocks,
  foldLabel,
}: {
  blocks: { key: number; node: ReactNode }[];
  foldLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const foldable = foldLabel !== undefined;
  const lastIndex = blocks.length - 1;
  return (
    <div aria-label="对话过程" className="min-w-0">
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          data-trace-toggle
          onClick={() => setExpanded(!expanded)}
          className={cn(toggleClass, 'mb-1')}
        >
          <CollapseChevron className="opacity-60 group-hover/row:opacity-100" open={expanded} />
          <span className="min-w-0 truncate">{foldLabel}</span>
        </button>
      )}
      {blocks.map(({ key, node }, index) =>
        foldable && index < lastIndex ? (
          <div
            key={key}
            hidden={!expanded}
            className={cn(fadeIn, 'ml-[0.4375rem] border-l border-line pl-[0.6875rem]')}
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
