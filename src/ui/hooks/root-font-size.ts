import { useEffect, useState } from 'react';

export function rootFontSize(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) ? size : 16;
}

/** 沙箱 iframe 是独立文档，rem 不继承外层根字号：订阅根元素 style 以保持内嵌文档同步。 */
export function useRootFontSize(): number {
  const [size, setSize] = useState(rootFontSize);
  useEffect(() => {
    const observer = new MutationObserver(() => setSize(rootFontSize()));
    observer.observe(document.documentElement, { attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
  return size;
}
