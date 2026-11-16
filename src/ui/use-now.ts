import { useEffect, useState } from 'react';

/** 按固定间隔刷新的当前时间戳；enabled 为假时停表。 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}
