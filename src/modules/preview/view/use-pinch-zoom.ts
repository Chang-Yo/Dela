/** 触控板双指捏合缩放（Chromium 派发为 ctrl+wheel）；普通滚轮保持原生滚动。 */
export function pinchZoomRef(
  setZoom: (update: (value: number) => number) => void,
  min: number,
  max: number,
  step: number,
) {
  return (element: HTMLDivElement) => {
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor =
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
          ? Math.exp(-event.deltaY / 100)
          : event.deltaY < 0
            ? 1 + step
            : 1 / (1 + step);
      setZoom((value) => Math.min(max, Math.max(min, value * factor)));
    };
    // 需要非 passive 监听才能 preventDefault，拦下 Chromium 对捏合的整页缩放。
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  };
}
