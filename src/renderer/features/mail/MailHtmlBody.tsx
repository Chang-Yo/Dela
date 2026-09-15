import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMailHtml } from './mail-html-display';
import { sanitizeMailHtml } from './mail-html';
import { cn } from '../../lib/utils';
import { frameHeightFromEvent, injectFrameHeightReport } from '../../components/ui/frame-height';

const toolbarToggle = cn(
  'h-7 rounded-full px-3 text-xs transition-colors',
  'aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-secondary-foreground',
  'aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:bg-muted',
);

/** 未收到高度上报前的初始正文高度(px),收到上报后替换为真实高度。 */
const INITIAL_BODY_HEIGHT = 240;

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  const [remoteImages, setRemoteImages] = useState(true);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(INITIAL_BODY_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const document = useMemo(() => {
    const doc = sanitizeMailHtml(html, remoteImages);
    injectFrameHeightReport(doc);
    return renderMailHtml(doc, fitWidth);
  }, [html, remoteImages, fitWidth]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const height = frameHeightFromEvent(event, iframeRef.current);
      if (height !== null) setBodyHeight(height);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="mt-3 flex flex-col">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          aria-pressed={fitWidth}
          className={toolbarToggle}
          onClick={() => setFitWidth(!fitWidth)}
          type="button"
        >
          {fitWidth ? '适应宽度' : '原始布局'}
        </button>
        <button
          aria-pressed={plain}
          className={toolbarToggle}
          onClick={() => setPlain(!plain)}
          type="button"
        >
          纯文本
        </button>
        <button
          aria-pressed={remoteImages}
          className={toolbarToggle}
          onClick={() => setRemoteImages(!remoteImages)}
          type="button"
        >
          远程图片：{remoteImages ? '显示' : '隐藏'}
        </button>
      </div>
      {plain ? (
        <div className="mt-3 rounded-t-lg border-x border-t p-4 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
          {text ?? new DOMParser().parseFromString(html, 'text/html').body.textContent}
        </div>
      ) : (
        <iframe
          className="mt-3 w-full rounded-t-lg border-x border-t bg-white"
          ref={iframeRef}
          referrerPolicy="no-referrer"
          sandbox="allow-popups allow-scripts"
          srcDoc={document}
          style={{ height: bodyHeight }}
          title="邮件正文"
        />
      )}
    </div>
  );
}
