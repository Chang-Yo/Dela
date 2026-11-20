import { useEffect, useState } from 'react';
import { shuiyuanFrame } from './shuiyuan-html';
import { HtmlFrame } from '../../../ui/html-frame';
import { shuiyuanTopicFromUrl } from '../contract';

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

/** 水源楼层/引用正文：给了 onOpenTopic 时站内话题链接在应用内打开，其余外链走系统浏览器。 */
export function ShuiyuanHtmlBody({
  html,
  title = '帖子正文',
  onOpenTopic,
  initialHeight = 48,
}: {
  html: string;
  title?: string;
  onOpenTopic?: (topicId: number, postNumber?: number) => void;
  initialHeight?: number;
}) {
  const dark = useIsDarkTheme();
  const openLink = (url: string) => {
    const topic = shuiyuanTopicFromUrl(url);
    if (topic && onOpenTopic) onOpenTopic(topic.topicId, topic.postNumber);
    else window.open(url);
  };
  return (
    <HtmlFrame
      {...shuiyuanFrame(dark)}
      className="bg-transparent"
      html={html}
      initialHeight={initialHeight}
      onLink={openLink}
      title={title}
    />
  );
}
