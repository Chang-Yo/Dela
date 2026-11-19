import { useEffect, useEffectEvent } from 'react';

export function useFrameMessages(onMessage: (event: MessageEvent) => void) {
  const handle = useEffectEvent(onMessage);
  useEffect(() => {
    const listener = (event: MessageEvent) => handle(event);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
}
