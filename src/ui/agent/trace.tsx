'use client';

import { Fragment, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Collapsible, CollapsibleChevron } from '../collapsible';
import { fadeIn } from '../lib/motion';

// 图标槽 size-4，引导线落在它的中线（ml-2），正文与行内文字对齐（2 + 线宽 + 3.75 = 6）。
const guide = 'ml-2 border-l border-line pl-3.75';

const rowClass =
  'group/row flex h-7 w-full min-w-0 items-center gap-2 rounded-chip text-left text-sm text-ink-2';

/** 行的状态色，只染图标与行尾结果：运行中 accent，失败 danger。 */
type TraceTone = 'neutral' | 'accent' | 'danger';

const toneText: Record<TraceTone, string> = {
  neutral: 'text-ink-3',
  accent: 'text-accent',
  danger: 'text-danger',
};

function TraceIcon({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: TraceTone }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5',
        toneText[tone],
        className,
      )}
      data-slot="trace-icon"
      {...props}
    />
  );
}

function TraceMeta({ tone, children }: { tone: TraceTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'ml-0.5 flex shrink-0 items-center gap-1.5 text-xs tabular-nums',
        toneText[tone],
      )}
      data-slot="trace-meta"
    >
      {children}
    </span>
  );
}

function TraceToggle({ open, className, ...props }: ComponentProps<'button'> & { open: boolean }) {
  return (
    <button
      aria-expanded={open}
      className={cn(
        rowClass,
        'transition-colors duration-base hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        className,
      )}
      // data-trace-toggle：消息列表据此在用户展开过程时暂停贴底跟随。
      data-trace-toggle
      type="button"
      {...props}
    />
  );
}

/**
 * 一行步骤：图标、内容、行尾结果，可展开时再带箭头（悬停、聚焦或展开时出现）。没有 children 时只是一行。
 * action 放在行尾、展开按钮之外，避免按钮嵌套。
 */
function TraceDisclosure({
  icon,
  head,
  meta,
  tone = 'neutral',
  action,
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  icon: ReactNode;
  head: ReactNode;
  meta?: ReactNode;
  tone?: TraceTone;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      <TraceIcon tone={tone}>{icon}</TraceIcon>
      <span className="flex min-w-0 items-center gap-1.5">
        {head}
        {meta && <TraceMeta tone={tone}>{meta}</TraceMeta>}
      </span>
    </>
  );
  const row = children ? (
    <TraceToggle onClick={() => setOpen(!open)} open={open}>
      {content}
      <CollapsibleChevron
        className={cn(
          'size-3.5 opacity-0 group-hover/row:opacity-60 group-focus-visible/row:opacity-60',
          open && 'opacity-60',
        )}
        open={open}
      />
    </TraceToggle>
  ) : (
    <div className={rowClass}>{content}</div>
  );
  return (
    <div className={cn('min-w-0', className)} data-slot="trace-disclosure" {...props}>
      {action ? (
        <div className="flex min-w-0 items-center gap-2">
          {row}
          {action}
        </div>
      ) : (
        row
      )}
      {children && (
        <Collapsible open={open}>
          <div className={cn(guide, 'min-w-0 pt-0.5 pb-2')}>{children}</div>
        </Collapsible>
      )}
    </div>
  );
}

type TraceFold = {
  label: string;
  /** 折叠行尾的整体状态，例如仍在后台运行的任务。 */
  meta?: ReactNode;
  tone?: TraceTone;
};

/**
 * 回复的过程块序列。给出 fold 时，最后一块之前的过程块按原顺序折进一行；
 * 过程块保持原位只是隐藏，最后一块在折叠前后是同一个节点。
 */
function Trace({
  blocks,
  fold,
  className,
  ...props
}: ComponentProps<'div'> & {
  blocks: { key: number; node: ReactNode }[];
  fold?: TraceFold;
}) {
  const [expanded, setExpanded] = useState(false);
  const lastIndex = blocks.length - 1;
  return (
    <div className={cn('min-w-0', className)} data-slot="trace" {...props}>
      {fold && (
        <TraceToggle className="mb-1" onClick={() => setExpanded(!expanded)} open={expanded}>
          <TraceIcon>
            <CollapsibleChevron open={expanded} />
          </TraceIcon>
          <span className="min-w-0 truncate">{fold.label}</span>
          {fold.meta && <TraceMeta tone={fold.tone ?? 'neutral'}>{fold.meta}</TraceMeta>}
        </TraceToggle>
      )}
      {blocks.map(({ key, node }, index) =>
        fold && index < lastIndex ? (
          <div key={key} hidden={!expanded} className={cn(fadeIn, guide)}>
            {node}
          </div>
        ) : (
          <Fragment key={key}>{node}</Fragment>
        ),
      )}
    </div>
  );
}

export { Trace, TraceDisclosure, type TraceFold, type TraceTone };
