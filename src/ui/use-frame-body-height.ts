import { useEffect, useState } from 'react';

/** 未量到真实高度前的初始高度(px)，与邮件正文一致。 */
const INITIAL_BODY_HEIGHT = 240;

/** 同源沙箱 iframe 的高度随 body 内容自适应；在 iframe 的 onLoad 里交出 body。 */
export function useFrameBodyHeight() {
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(INITIAL_BODY_HEIGHT);
  useEffect(() => {
    if (!body) return;
    const update = () => setHeight(body.scrollHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [body]);
  return [height, setBody] as const;
}
