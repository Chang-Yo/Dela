import { useEffect, useState } from 'react';

const INITIAL_BODY_HEIGHT = 240;

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
