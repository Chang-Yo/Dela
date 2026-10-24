import { useEffect, useMemo, useRef, useState } from 'react';
import { renderShuiyuanHtml, sanitizeShuiyuanHtml } from './shuiyuan-html';
import {
  frameHeightFromEvent,
  frameLinkFromEvent,
  injectFrameHeightReport,
} from '../../components/ui/frame-height';
import { SHUIYUAN_HOST, shuiyuanTopicFromUrl } from '../../../shared/shuiyuan';
import { useRootFontSize } from '../../lib/root-font-size';

const INITIAL_BODY_HEIGHT = 48;

/**
 * 应用的生效主题（偏好 system 时跟随系统）；iframe 文档取不到外层 class，
 * 由这里解析成布尔并注入楼层文档。
 */
function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const resolve = () =>
      root.classList.contains('dark')
        ? setDark(true)
        : root.classList.contains('light')
          ? setDark(false)
          : setDark(media.matches);
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    media.addEventListener('change', resolve);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', resolve);
    };
  }, []);
  return dark;
}

/**
 * 水源楼层/引用正文的沙箱渲染：不透明源 iframe + 高度自适应上报，
 * 外链经 sandbox allow-popups + 主进程 windowOpenHandler 走系统浏览器。
 */
export function ShuiyuanHtmlBody({
  html,
  title = '帖子正文',
  onOpenTopic,
}: {
  html: string;
  title?: string;
  onOpenTopic?: (topicId: number, postNumber?: number) => void;
}) {
  const dark = useIsDarkTheme();
  const rootSize = useRootFontSize();
  const [bodyHeight, setBodyHeight] = useState(INITIAL_BODY_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const internalNavigation = Boolean(onOpenTopic);
  const document = useMemo(() => {
    const doc = sanitizeShuiyuanHtml(html);
    injectFrameHeightReport(doc, internalNavigation ? SHUIYUAN_HOST : undefined);
    return renderShuiyuanHtml(doc, dark, rootSize);
  }, [html, dark, rootSize, internalNavigation]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const height = frameHeightFromEvent(event, iframeRef.current);
      if (height !== null) setBodyHeight(height);
      const href = frameLinkFromEvent(event, iframeRef.current);
      const target = href ? shuiyuanTopicFromUrl(href) : null;
      if (target && onOpenTopic) onOpenTopic(target.topicId, target.postNumber);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onOpenTopic]);

  return (
    <iframe
      className="w-full border-0 bg-transparent"
      ref={iframeRef}
      referrerPolicy="no-referrer"
      sandbox="allow-popups allow-scripts"
      srcDoc={document}
      style={{ height: bodyHeight }}
      title={title}
    />
  );
}
