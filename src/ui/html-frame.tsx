import { useRef, useState } from 'react';
import { useRootFontSize } from './hooks/root-font-size';
import { useFrameMessages } from './hooks/use-frame-messages';
import { cn } from './lib/cn';
import { htmlFrameDocument, type HtmlFrameDocumentOptions } from './lib/html-frame-document';
import { openLightbox } from './lightbox';

type FrameMessage = {
  source?: unknown;
  height?: unknown;
  href?: unknown;
  src?: unknown;
  alt?: unknown;
  top?: unknown;
};

/**
 * 所有外部网页（邮件、通知、帖子、作业描述、HTML 文件）的唯一出口。沙箱只给 allow-scripts：
 * 不透明源让外层摸不到内部，内部也摸不到外层，二者只经 postMessage 交换上报的事实。
 * 不透传 iframe 的原生 props，调用方改不了沙箱。
 */
function HtmlFrame({
  html,
  title,
  className,
  fill = false,
  initialHeight = 240,
  initialScroll,
  onScroll,
  onLink = (url) => window.open(url),
  ...options
}: HtmlFrameDocumentOptions & {
  html: string;
  title: string;
  className?: string;
  /** 撑满容器、在内部滚动；否则随内容增高，由外层滚动。 */
  fill?: boolean;
  initialHeight?: number;
  initialScroll?: () => number;
  onScroll?: (top: number) => void;
  onLink?: (url: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(initialHeight);
  const rootSize = useRootFontSize();
  const document = htmlFrameDocument(html, { ...options, rootSize, fill });

  useFrameMessages((event) => {
    if (event.source !== frameRef.current?.contentWindow) return;
    const data = event.data as FrameMessage | null;
    if (data?.source === 'dela-frame-height' && typeof data.height === 'number')
      setHeight(Math.max(0, Math.ceil(data.height)));
    else if (data?.source === 'dela-frame-link' && typeof data.href === 'string') onLink(data.href);
    else if (
      data?.source === 'dela-frame-image' &&
      typeof data.src === 'string' &&
      typeof data.alt === 'string'
    )
      openLightbox(data.src, data.alt);
    else if (data?.source === 'dela-frame-scroll' && typeof data.top === 'number')
      onScroll?.(data.top);
  });

  return (
    <iframe
      className={cn('block w-full border-0', fill && 'h-full', className)}
      data-slot="html-frame"
      onLoad={(event) => {
        if (initialScroll)
          event.currentTarget.contentWindow?.postMessage(
            { source: 'dela-frame-scroll-to', top: initialScroll() },
            '*',
          );
      }}
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={document}
      style={fill ? undefined : { height }}
      title={title}
    />
  );
}

export { HtmlFrame };
