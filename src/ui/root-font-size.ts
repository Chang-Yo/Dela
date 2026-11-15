import { useEffect, useState } from 'react';

/** 当前根字号（px）：设置 › 外观 › 字号写的就是根元素的 font-size。 */
export function rootFontSize(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) ? size : 16;
}

/**
 * 沙箱 iframe 是独立文档，rem 不继承外层根字号：邮件正文、水源楼层与网页预览要把这个值
 * 注进内层 html 才随字号缩放（见 mail-html-display / shuiyuan-html）。
 * 改字号就是改根元素的 style，故订阅它保持已打开的内嵌文档同步。
 */
export function useRootFontSize(): number {
  const [size, setSize] = useState(rootFontSize);
  useEffect(() => {
    const observer = new MutationObserver(() => setSize(rootFontSize()));
    observer.observe(document.documentElement, { attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
  return size;
}
