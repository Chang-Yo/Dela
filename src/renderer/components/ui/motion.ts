// 全局动效规范（缓动与 pop-in 观感取自 beautiful-ui，见 beautifului.css）：
// - 浮层/对话框出现：dialog-in 160ms ease-out-strong（scale .96→1 + 淡入）；
// - 遮罩出现：fade-in 160ms；
// - 悬停/选中颜色：150ms（工具类 duration-150）；
// - 进行中：Shimmer 或 animate-spin。
// dialog-in 只动 scale 属性（不是 transform），不会覆盖 -translate-1/2 的居中。

/** 遮罩淡入与对话框缩放入场（单独导出，供自绘遮罩/面板使用）。 */
export const overlayFade = 'animate-[fade-in_160ms_var(--ease-out-strong)_both]';
export const dialogIn = 'animate-[dialog-in_160ms_var(--ease-out-strong)_both]';

export const dialogOverlay = `fixed inset-0 z-50 bg-black/30 ${overlayFade}`;

/** 对话框面板外观（定位与尺寸由调用方给出，如 max-w-md、max-h-[85vh]）。 */
export const dialogPanel = `fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-window bg-surface p-6 text-ink shadow-overlay outline-none ${dialogIn} max-md:w-[calc(100%-2rem)]`;

/** 抽屉/底部面板入场（keyframes 见 globals.css）。 */
export const drawerFromLeft = 'animate-[drawer-left_200ms_var(--ease-out-strong)_both]';
export const drawerFromRight = 'animate-[drawer-right_200ms_var(--ease-out-strong)_both]';
export const sheetUp = 'animate-[sheet-up_200ms_var(--ease-out-strong)_both]';
/** 淡入（遮罩以外的轻量出现，如展开内容、计数）。 */
export const fadeIn = 'animate-[fade-in_150ms_ease-out_both]';
