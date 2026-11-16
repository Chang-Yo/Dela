// dialog-in 只动 scale 属性，不会覆盖 -translate-1/2 的居中。

export const overlayFade = 'animate-overlay-in';
export const dialogIn = 'animate-dialog-in';

export const dialogOverlay = `fixed inset-0 z-overlay bg-scrim ${overlayFade}`;

export const dialogPanel = `fixed left-1/2 top-1/2 z-overlay w-full -translate-x-1/2 -translate-y-1/2 rounded-window bg-surface p-6 text-ink shadow-overlay outline-none ${dialogIn} max-md:w-[calc(100%-2rem)]`;

export const drawerFromLeft = 'animate-drawer-left';
export const drawerFromRight = 'animate-drawer-right';
export const sheetUp = 'animate-sheet-up';
export const fadeIn = 'animate-fade-in';
