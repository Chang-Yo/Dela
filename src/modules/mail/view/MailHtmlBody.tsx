import { useRef, useState } from 'react';
import { renderMailHtml } from './mail-html-display';
import { sanitizeMailHtml } from './mail-html';
import { cn } from '../../../ui/lib/cn';
import { frameHeightFromEvent, injectFrameHeightReport } from './frame-height';
import { useRootFontSize } from '../../../ui/hooks/root-font-size';
import { useFrameMessages } from '../../../ui/hooks/use-frame-messages';

const toolbarToggle = cn(
  'h-7 rounded-full px-3 text-xs transition-colors',
  'aria-pressed:bg-selected aria-pressed:font-medium aria-pressed:text-ink',
  'aria-[pressed=false]:text-ink-3 aria-[pressed=false]:hover:bg-hover',
);

const INITIAL_BODY_HEIGHT = 240;

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  // 远程图片默认加载（用户裁决）；担心跟踪像素时可按这封邮件一键隐藏，偏好不落盘。
  const [remoteImages, setRemoteImages] = useState(true);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(INITIAL_BODY_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootSize = useRootFontSize();
  const doc = sanitizeMailHtml(html, remoteImages);
  injectFrameHeightReport(doc);
  const document = renderMailHtml(doc, fitWidth, rootSize);

  useFrameMessages((event) => {
    const height = frameHeightFromEvent(event, iframeRef.current);
    if (height !== null) setBodyHeight(height);
  });

  return (
    <div className="mt-3 flex flex-col">
      <div className="flex items-center gap-1.5">
        <button
          aria-pressed={plain}
          className={toolbarToggle}
          onClick={() => setPlain(!plain)}
          type="button"
        >
          纯文本
        </button>
        <button
          aria-pressed={fitWidth}
          className={toolbarToggle}
          onClick={() => setFitWidth(!fitWidth)}
          type="button"
        >
          适应宽度
        </button>
        <button
          aria-pressed={remoteImages}
          className={toolbarToggle}
          onClick={() => setRemoteImages(!remoteImages)}
          type="button"
        >
          {remoteImages ? '隐藏远程图片' : '加载远程图片'}
        </button>
      </div>
      {plain ? (
        <div className="mt-3 rounded-t-card border-x border-t p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
          {text ?? new DOMParser().parseFromString(html, 'text/html').body.textContent}
        </div>
      ) : (
        <iframe
          className="mt-3 w-full rounded-t-card border-x border-t bg-paper"
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
