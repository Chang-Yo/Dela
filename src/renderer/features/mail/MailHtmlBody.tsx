import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMailHtml } from './mail-html-display';
import { sanitizeMailHtml } from './mail-html';
import { cn } from '../../lib/utils';
import { frameHeightFromEvent, injectFrameHeightReport } from '../../components/ui/frame-height';
import { useRootFontSize } from '../../lib/root-font-size';

const toolbarToggle = cn(
  'h-7 rounded-full px-3 text-xs transition-colors',
  'aria-pressed:bg-hover-2 aria-pressed:font-medium aria-pressed:text-ink',
  'aria-[pressed=false]:text-ink-3 aria-[pressed=false]:hover:bg-hover',
);

/** 未收到高度上报前的初始正文高度(px),收到上报后替换为真实高度。 */
const INITIAL_BODY_HEIGHT = 240;

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  // 远程图片默认加载（用户裁决，2026-10-10）：隐私页的说明本来就是「默认显示、可切换为隐藏」，
  // 代码与它不一致。担心跟踪像素时按这封邮件一键隐藏，偏好不落盘。
  const [remoteImages, setRemoteImages] = useState(true);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(INITIAL_BODY_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootSize = useRootFontSize();
  const document = useMemo(() => {
    const doc = sanitizeMailHtml(html, remoteImages);
    injectFrameHeightReport(doc);
    return renderMailHtml(doc, fitWidth, rootSize);
  }, [html, remoteImages, fitWidth, rootSize]);

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
      {/* 三个开关并列常驻：原先「适应宽度」收在只有它一项的「更多」菜单里，等于白多一次点击。 */}
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
        <div className="mt-3 rounded-t-lg border-x border-t p-4 text-13 leading-relaxed whitespace-pre-wrap break-words">
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
