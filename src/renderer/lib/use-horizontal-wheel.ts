import { useEffect, useRef } from 'react';

/**
 * 横向溢出的容器接不住纵向滚轮：浏览器只发 deltaY，不会替它横滚（只有 shift+滚轮或触控板横滑才行）。
 * 这里把纵向增量转成横向滚动，到两端后就不再接管，滚轮交回页面。
 *
 * 增量必须先夹住再滚：滚轮一步常跨过端点，直接放行越界增量会让这一步原地不动，容器永远差
 * 几十像素到不了头。
 *
 * 需要 `{ passive: false }` 才能 preventDefault，所以手动挂监听；React 的 onWheel 是被动的。
 */
export function useHorizontalWheel<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = element.scrollWidth - element.clientWidth;
      const next = Math.min(Math.max(element.scrollLeft + event.deltaY, 0), max);
      // 该方向已到头：这一步交给页面滚，避免在两端吃掉滚轮。
      if (next === element.scrollLeft) return;
      event.preventDefault();
      element.scrollLeft = next;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  return ref;
}
