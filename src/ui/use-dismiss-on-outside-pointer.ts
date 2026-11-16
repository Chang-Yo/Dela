import { useEffect, useEffectEvent } from 'react';

/** 确认态「点别处即取消」：active 期间，落在 keepSelector 之外的按下触发 dismiss；escape 时 Esc 也取消。 */
export function useDismissOnOutsidePointer(
  active: boolean,
  keepSelector: string,
  dismiss: () => void,
  { escape = false }: { escape?: boolean } = {},
) {
  const onDismiss = useEffectEvent(dismiss);
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest(keepSelector))) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    if (escape) document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active, keepSelector, escape]);
}
