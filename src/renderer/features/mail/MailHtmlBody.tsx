import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMailHtml } from './mail-html-display';
import { sanitizeMailHtml } from './mail-html';
import { cn } from '../../lib/utils';

const toolbarToggle = cn(
  'h-7 rounded-full px-3 text-xs transition-colors',
  'aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-secondary-foreground',
  'aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:bg-muted',
);

/** iframe 注入脚本上报高度时的 postMessage source 标识,父页面据此校验消息形状。 */
const HEIGHT_SOURCE = 'dela-mail-body-height';

/** 未收到高度上报前的初始正文高度(px),收到上报后替换为真实高度。 */
const INITIAL_BODY_HEIGHT = 240;

/**
 * 注入向父页面上报正文高度的脚本,并在 CSP 放行该内联脚本。沙箱 iframe(opaque origin)
 * 的文档高度父页面读不到,只能由脚本 postMessage。必须在 sanitize 之后调用,避免被剥除。
 */
function injectHeightReport(doc: Document) {
  const policy = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (policy)
    policy.setAttribute(
      'content',
      `${policy.getAttribute('content') ?? ''}; script-src 'unsafe-inline'`,
    );
  const script = doc.createElement('script');
  script.textContent = `(function(){var send=function(){window.parent.postMessage({source:${JSON.stringify(
    HEIGHT_SOURCE,
  )},height:document.documentElement.scrollHeight},"*")};if("ResizeObserver" in window){new ResizeObserver(send).observe(document.documentElement)}send()})()`;
  doc.body.append(script);
}

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  const [remoteImages, setRemoteImages] = useState(true);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(INITIAL_BODY_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const document = useMemo(() => {
    const doc = sanitizeMailHtml(html, remoteImages);
    injectHeightReport(doc);
    return renderMailHtml(doc, fitWidth);
  }, [html, remoteImages, fitWidth]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { source?: unknown; height?: unknown } | null;
      if (!data || data.source !== HEIGHT_SOURCE) return;
      const { height } = data;
      if (typeof height !== 'number' || !Number.isFinite(height)) return;
      setBodyHeight(Math.max(0, Math.ceil(height)));
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
