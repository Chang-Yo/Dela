import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { QuoteBlock } from './quote-block';

function MessageComments({
  comments,
  className,
  ...props
}: ComponentProps<'div'> & { comments: { quote: string; comment?: string }[] }) {
  return (
    <div
      className={cn('mb-1.5 grid max-w-message justify-items-end gap-1', className)}
      data-slot="message-comments"
      {...props}
    >
      {comments.map(({ quote, comment }, index) => (
        <div
          className="grid min-w-0 max-w-full gap-0.5 rounded-card bg-inset px-3 py-1.5 text-xs leading-5 shadow-hairline wrap-anywhere"
          key={index}
        >
          <QuoteBlock className="line-clamp-3">{quote}</QuoteBlock>
          {comment && <p className="whitespace-pre-wrap text-ink-2">{comment}</p>}
        </div>
      ))}
    </div>
  );
}

export { MessageComments };
