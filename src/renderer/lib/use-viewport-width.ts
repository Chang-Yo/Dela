import { useEffect, useState } from 'react';

/** 视口宽度镜像（rAF 合帧的 resize 监听）：侧栏按视口钳制渲染宽度时共用。 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return width;
}
