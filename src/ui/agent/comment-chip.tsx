'use client';

import { useState, type ComponentProps } from 'react';
import { TextQuote, X } from 'lucide-react';
import { Button } from '../button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../hover-card';
import { Popover, PopoverAnchor, PopoverContent } from '../popover';
import { Chip } from './chip';
import { CommentInput } from './comment-input';
import { QuoteBlock } from './quote-block';

type CommentItem = { quote: string; comment: string };

function CommentChip({
  item,
  onSave,
  onRemove,
  ...props
}: ComponentProps<typeof Chip> & {
  item: CommentItem;
  onSave: (comment: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [peek, setPeek] = useState(false);
  return (
    <Popover onOpenChange={setEditing} open={editing}>
      <HoverCard closeDelay={100} onOpenChange={setPeek} open={peek && !editing} openDelay={300}>
        <PopoverAnchor asChild>
          <HoverCardTrigger asChild>
            <Chip
              className="max-w-64 pr-0.5"
              data-slot="comment-chip"
              style={{ animation: 'pop-in 200ms var(--ease-out-strong) both' }}
              {...props}
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
              <Button variant="ghost" size="icon-xs" aria-label="移除评论" onClick={onRemove}>
                <X strokeWidth={2.2} />
              </Button>
            </Chip>
          </HoverCardTrigger>
        </PopoverAnchor>
        <HoverCardContent align="start" className="max-h-80 w-72 gap-2 leading-5" side="top">
          <QuoteBlock className="line-clamp-6 break-words">{item.quote}</QuoteBlock>
          {item.comment && (
            <p className="whitespace-pre-wrap break-words text-ink">{item.comment}</p>
          )}
        </HoverCardContent>
      </HoverCard>
      <PopoverContent
        align="start"
        className="grid w-80 gap-1.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={6}
      >
        <QuoteBlock className="mx-2 mt-1.5 line-clamp-3 break-words text-xs leading-5">
          {item.quote}
        </QuoteBlock>
        <CommentInput
          initial={item.comment}
          onCancel={() => setEditing(false)}
          onSubmit={(comment) => {
            onSave(comment);
            setEditing(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { CommentChip, type CommentItem };
