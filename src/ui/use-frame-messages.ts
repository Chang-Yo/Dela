import { useEffect, useEffectEvent } from 'react';

/** 沙箱 iframe 经 postMessage 上报的消息：挂载期间监听 window，由调用方按来源窗口过滤。 */
export function useFrameMessages(onMessage: (event: MessageEvent) => void) {
  const handle = useEffectEvent(onMessage);
  useEffect(() => {
    const listener = (event: MessageEvent) => handle(event);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
}
