import { useEffect, useMemo, useRef, useState } from 'react';
import { renderShuiyuanHtml, sanitizeShuiyuanHtml } from './shuiyuan-html';
import { frameHeightFromEvent, injectFrameHeightReport } from '../../components/ui/frame-height';

const INITIAL_BODY_HEIGHT = 80;

/**
 * 水源楼层/引用正文的沙箱渲染：不透明源 iframe + 高度自适应上报，
 * 外链经 sandbox allow-popups + 主进程 windowOpenHandler 走系统浏览器。
 */
export function ShuiyuanHtmlBody({ html, title = '帖子正文' }: { html: string; title?: string }) {
  const [bodyHeight, setBodyHeight] = useState(INITIAL_BODY_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const document = useMemo(() => {
    const doc = sanitizeShuiyuanHtml(html);
    injectFrameHeightReport(doc);
    return renderShuiyuanHtml(doc);
  }, [html]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const height = frameHeightFromEvent(event, iframeRef.current);
      if (height !== null) setBodyHeight(height);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      className="w-full rounded-lg border bg-white"
      ref={iframeRef}
      referrerPolicy="no-referrer"
      sandbox="allow-popups allow-scripts"
      srcDoc={document}
      style={{ height: bodyHeight }}
      title={title}
    />
  );
}
