// 回复评论：在已完成回复的正文里选中文字 → 浮出「添加到对话」→ 原地变为评论输入框 → 确认后进入
// composer 附件条上方的评论轨道，随草稿保存，发送时作为结构化评论交给主进程拼进提示词。
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { HoverCard, Popover } from 'radix-ui';
import { Check, MessageCircleQuestion, MessageSquarePlus, TextQuote, X } from 'lucide-react';
import type { ChatComment } from '../../../shared/api';
import { menuPanel } from '@/components/ui/menu-styles';
import { cn } from '../../lib/utils';
import { useChatDrafts } from './drafts';

/** 浮层与视口边缘、与选区之间的留白（rem）。 */
const EDGE_REM = 0.5;
/** 写评论时原选区的高亮名，样式见 globals.css 的 ::highlight。 */
const HIGHLIGHT = 'dela-reply-comment';

export interface FloatingAnchor {
  /** 选区上沿、下沿，相对消息视口。 */
  top: number;
  bottom: number;
  /** 首行、末行的水平中点：浮层在上方时对齐首行，在下方时对齐末行。 */
  topCenter: number;
  bottomCenter: number;
}

export interface FloatingSpot {
  top: number;
  left: number;
  side: 'top' | 'bottom';
}

/**
 * 浮层在消息视口里的位置：优先放在选区上方，放不下翻到下方，都放不下（选区高过视口）贴上沿。
 * 结果始终夹在视口内，不压上方的会话栏，也不压下方的输入框。选区整个滚出视口时，pin=false
 * 返回 null（隐藏）；pin=true 贴在离它最近的边缘，正在写的评论不会随滚动消失。
 */
export function placeFloating(
  anchor: FloatingAnchor,
  box: { width: number; height: number },
  view: { width: number; height: number },
  edge: number,
  pin: boolean,
): FloatingSpot | null {
  if (!pin && (anchor.bottom <= 0 || anchor.top >= view.height)) return null;
  const maxTop = Math.max(edge, view.height - edge - box.height);
  const above = anchor.top - edge - box.height;
  const below = anchor.bottom + edge;
  const side = above >= edge || below > maxTop ? 'top' : 'bottom';
  const top = Math.min(Math.max(side === 'top' ? above : below, edge), maxTop);
  const center = side === 'top' ? anchor.topCenter : anchor.bottomCenter;
  const left = Math.min(
    Math.max(center - box.width / 2, edge),
    Math.max(edge, view.width - edge - box.width),
  );
  return { top, left, side };
}

const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);

/**
 * 可评论的选区：落在 root 内同一段已完成回复的正文里（data-assistant-body，流式中的回复带
 * data-reply-live）。返回独立的 Range：端点落在公式内部时扩到整个公式，引用才能取回完整 TeX。
 */
export function commentRange(selection: Selection | null, root: HTMLElement): Range | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const body = elementOf(range.startContainer)?.closest('[data-assistant-body]');
  if (!body || !root.contains(body) || body.closest('[data-reply-live]')) return null;
  if (!body.contains(range.endContainer)) {
    // 三击选段时终点常落在下一个块的开头：正文之后没有选中文字就收回到正文末尾，否则是跨块选区。
    const tail = document.createRange();
    tail.setStart(body, body.childNodes.length);
    tail.setEnd(range.endContainer, range.endOffset);
    if (tail.toString().trim()) return null;
    range.setEnd(body, body.childNodes.length);
  }
  const startMath = elementOf(range.startContainer)?.closest('.katex');
  if (startMath) range.setStartBefore(startMath);
  const endMath = elementOf(range.endContainer)?.closest('.katex');
  if (endMath) range.setEndAfter(endMath);
  return range;
}

/** 选区 → 引用文字：按渲染后的分行取（innerText），KaTeX 换回 TeX 源码，免得 MathML 与 HTML 两份文字叠在一起。 */
function quoteText(range: Range): string {
  const fragment = range.cloneContents();
  for (const math of fragment.querySelectorAll('.katex')) {
    const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex == null) continue;
    const display = math.parentElement?.classList.contains('katex-display')
      ? math.parentElement
      : null;
    if (display) {
      const block = document.createElement('div');
      block.textContent = `$$${tex}$$`;
      display.replaceWith(block);
    } else math.replaceWith(`$${tex}$`);
  }
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;top:0;left:-200vw;width:40rem';
  holder.append(fragment);
  document.body.append(holder);
  const text = holder.innerText;
  holder.remove();
  return text.trim();
}

/** 评论输入：回车或 ✓ 确认（可留空），Shift+回车换行，Esc 取消；输入法组字时的回车不提交。 */
function CommentInput({
  initial = '',
  onSubmit,
  onCancel,
}: {
  initial?: string;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    // 聚焦不滚动消息视口；改评论时光标放在原文末尾。
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const submit = () => onSubmit(text.trim());
  return (
    <div className="flex items-end gap-1">
      <textarea
        aria-label="评论"
        className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-13 leading-5 text-ink outline-none [field-sizing:content] placeholder:text-ink-3"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder="添加评论…"
        ref={fieldRef}
        rows={1}
        value={text}
      />
      <button
        aria-label="确认"
        className="flex size-7 shrink-0 items-center justify-center rounded-control bg-ink text-surface transition-transform duration-150 active:scale-[0.94]"
        onClick={submit}
        title="确认"
        type="button"
      >
        <Check className="size-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}

interface Target {
  range: Range;
  quote: string;
  editing: boolean;
}

/**
 * 选区评论浮层。挂在消息视口的定位容器上（不随内容滚动），位置随滚动、视口与内容尺寸变化重算，
 * 始终夹在视口内。按下指针即收起（拖选途中不留旧浮层，写到一半点别处即放弃），拖滚动条除外。
 */
export function ReplyCommentLayer({
  draftKey,
  scrollRef,
  onSidechat,
}: {
  /** 评论落进哪份草稿：主会话的 sessionId，旁问里是旁问草稿的键。 */
  draftKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 选中文字后另起旁问：把引用带进旁问的输入框；未提供时不显示入口。 */
  onSidechat?: (quote: string) => void;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const inBox = (event: Event) => boxRef.current?.contains(event.target as Node) ?? false;
    const keepEditing = (current: Target | null) => (current?.editing ? current : null);
    const down = (event: PointerEvent) => {
      if (!inBox(event) && event.target !== scroller) setTarget(null);
    };
    // 双击、三击的选区在松开指针后才落定，下一帧再读。
    const up = (event: PointerEvent) => {
      if (inBox(event)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const range = commentRange(window.getSelection(), scroller);
        const quote = range && quoteText(range);
        if (range && quote) setTarget({ range, quote, editing: false });
      });
    };
    const collapse = () => {
      if (window.getSelection()?.isCollapsed) setTarget(keepEditing);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTarget(keepEditing);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('selectionchange', collapse);
    document.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('selectionchange', collapse);
      document.removeEventListener('keydown', escape);
    };
  }, [scrollRef]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const box = boxRef.current;
    if (!target || !scroller || !box) return;
    const place = () => {
      const rects = [...target.range.getClientRects()].filter((rect) => rect.width || rect.height);
      // 正文被折叠或重新渲染：选区已不在页面上。
      if (!rects.length) {
        setTarget(null);
        return;
      }
      const view = scroller.getBoundingClientRect();
      const first = rects[0]!;
      const last = rects.at(-1)!;
      const spot = placeFloating(
        {
          top: Math.min(...rects.map((rect) => rect.top)) - view.top,
          bottom: Math.max(...rects.map((rect) => rect.bottom)) - view.top,
          topCenter: (first.left + first.right) / 2 - view.left,
          bottomCenter: (last.left + last.right) / 2 - view.left,
        },
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: scroller.clientWidth, height: scroller.clientHeight },
        EDGE_REM * parseFloat(getComputedStyle(document.documentElement).fontSize),
        target.editing,
      );
      box.style.visibility = spot ? '' : 'hidden';
      if (!spot) return;
      box.style.top = `${spot.top}px`;
      box.style.left = `${spot.left}px`;
      box.style.transformOrigin = spot.side === 'top' ? 'bottom center' : 'top center';
    };
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    observer.observe(box);
    for (const child of scroller.children) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, [scrollRef, target]);

  // 输入框拿走焦点后原生选区就没了，写评论期间用 CSS 高亮标出被评论的原文。
  useEffect(() => {
    if (!target?.editing) return;
    CSS.highlights.set(HIGHLIGHT, new Highlight(target.range));
    return () => {
      CSS.highlights.delete(HIGHLIGHT);
    };
  }, [target]);

  if (!target) return null;
  const add = (comment: string) => {
    const { drafts, update } = useChatDrafts.getState();
    update(draftKey, {
      comments: [...(drafts[draftKey]?.comments ?? []), { quote: target.quote, comment }],
    });
    setTarget(null);
  };
  return (
    <div
      className={cn(
        'absolute z-20 rounded-card bg-surface shadow-raised animate-[pop-in_160ms_var(--ease-out-strong)_both]',
        target.editing ? 'w-80 max-w-[calc(100%-1rem)] p-1' : 'w-max p-0.5',
      )}
      key={target.editing ? 'input' : 'tip'}
      ref={boxRef}
    >
      {target.editing ? (
        <CommentInput onCancel={() => setTarget(null)} onSubmit={add} />
      ) : (
        <div className="flex">
          <button
            className="flex h-7 select-none items-center gap-1.5 whitespace-nowrap rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink [&_svg]:size-3.5"
            onClick={() => setTarget({ ...target, editing: true })}
            // 不抢焦点、不清选区：点下去之前选中的文字保持原样。
            onPointerDown={(event) => event.preventDefault()}
            type="button"
          >
            <MessageSquarePlus aria-hidden />
            添加到对话
          </button>
          {onSidechat && (
            <button
              className="flex h-7 select-none items-center gap-1.5 whitespace-nowrap rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink [&_svg]:size-3.5"
              onClick={() => {
                onSidechat(target.quote);
                setTarget(null);
              }}
              onPointerDown={(event) => event.preventDefault()}
              type="button"
            >
              <MessageCircleQuestion aria-hidden />
              旁问
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** composer 里附件条上方的评论轨道：悬停看全文，点击改评论，✕ 删除。 */
export function ReplyCommentRail({
  comments,
  onChange,
}: {
  comments: ChatComment[];
  onChange: (comments: ChatComment[]) => void;
}) {
  return (
    // 评论数量不设上限：超过三行在轨道内滚动；-m-px/p-px 给 chip 的描边留出位置，不被裁掉。
    <div className="-m-px flex max-h-24 flex-wrap gap-1.5 overflow-y-auto p-px">
      {comments.map((item, index) => (
        <CommentChip
          item={item}
          key={`${index}:${item.quote}`}
          onRemove={() => onChange(comments.filter((_, at) => at !== index))}
          onSave={(comment) =>
            onChange(comments.map((other, at) => (at === index ? { ...other, comment } : other)))
          }
        />
      ))}
    </div>
  );
}

const quoteBlock = 'whitespace-pre-wrap break-words border-l-2 border-line-strong pl-2 text-ink-3';

function CommentChip({
  item,
  onSave,
  onRemove,
}: {
  item: ChatComment;
  onSave: (comment: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [peek, setPeek] = useState(false);
  return (
    <Popover.Root onOpenChange={setEditing} open={editing}>
      <HoverCard.Root
        closeDelay={100}
        onOpenChange={setPeek}
        open={peek && !editing}
        openDelay={300}
      >
        <Popover.Anchor asChild>
          <HoverCard.Trigger asChild>
            <span
              className="flex h-7 min-w-0 max-w-64 items-center rounded-control bg-field pr-0.5 text-xs text-ink-2 shadow-hairline"
              style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}
            >
              <button
                aria-label="编辑评论"
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 pl-2 text-left"
                onClick={() => setEditing(true)}
                type="button"
              >
                <TextQuote aria-hidden className="size-3.5 shrink-0 text-ink-3" />
                {item.comment && <span className="max-w-24 truncate text-ink-3">{item.quote}</span>}
                <span className="truncate">{item.comment || item.quote}</span>
              </button>
              <button
                aria-label="移除评论"
                className="flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
                onClick={onRemove}
                type="button"
              >
                <X className="size-3" strokeWidth={2.2} />
              </button>
            </span>
          </HoverCard.Trigger>
        </Popover.Anchor>
        <HoverCard.Portal>
          <HoverCard.Content
            align="start"
            className={cn(menuPanel, 'grid max-h-80 w-72 gap-2 p-3 text-xs leading-5')}
            collisionPadding={8}
            side="top"
            sideOffset={6}
          >
            <blockquote className={cn(quoteBlock, 'line-clamp-6')}>{item.quote}</blockquote>
            {item.comment && (
              <p className="whitespace-pre-wrap break-words text-ink">{item.comment}</p>
            )}
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
      <Popover.Portal>
        <Popover.Content
          align="start"
          className={cn(menuPanel, 'grid w-80 gap-1.5 p-1')}
          collisionPadding={8}
          // 焦点交给评论输入框自己（光标放到末尾）。
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="top"
          sideOffset={6}
        >
          <blockquote className={cn(quoteBlock, 'mx-2 mt-1.5 line-clamp-3 text-xs leading-5')}>
            {item.quote}
          </blockquote>
          <CommentInput
            initial={item.comment}
            onCancel={() => setEditing(false)}
            onSubmit={(comment) => {
              onSave(comment);
              setEditing(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
