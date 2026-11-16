import { useEffect, useRef } from 'react';

/**
 * 纵向滚轮转成横向滚动，到两端后交回页面。增量须先夹住再滚，否则越界一步会原地不动；
 * passive: false 才能 preventDefault，故手动挂监听。
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
      if (next === element.scrollLeft) return;
      event.preventDefault();
      element.scrollLeft = next;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  return ref;
}
