// 入场动画取自 tokens.css 的 --animate-*，缓动与观感取自 beautiful-ui。
// dialog-in 只动 scale 属性，不会覆盖 -translate-1/2 的居中。

/** 遮罩淡入与对话框缩放入场（单独导出，供自绘遮罩/面板使用）。 */
export const overlayFade = 'animate-overlay-in';
export const dialogIn = 'animate-dialog-in';

export const dialogOverlay = `fixed inset-0 z-50 bg-scrim ${overlayFade}`;

/** 对话框面板外观（定位与尺寸由调用方给出，如 max-w-md、max-h-[85vh]）。 */
export const dialogPanel = `fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-window bg-surface p-6 text-ink shadow-overlay outline-none ${dialogIn} max-md:w-[calc(100%-2rem)]`;

/** 抽屉/底部面板入场。 */
export const drawerFromLeft = 'animate-drawer-left';
export const drawerFromRight = 'animate-drawer-right';
export const sheetUp = 'animate-sheet-up';
/** 淡入（遮罩以外的轻量出现，如展开内容、计数）。 */
export const fadeIn = 'animate-fade-in';
