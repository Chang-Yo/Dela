// 工作台目录侧栏的可见性状态：宽屏折叠 / 窄屏抽屉开合 + 窄屏媒体查询镜像。
// 展开入口渲染在焦点组标签栏左侧（TabBar/EmptyState），与目录本体（app/workbench-explorer）
// 共享此 store；折叠偏好沿用原 localStorage 键。
import { create } from 'zustand';
import { PanelLeft } from 'lucide-react';
import { cn } from '../lib/utils';

const NARROW_QUERY = '(max-width: 767px)';
const collapsedStorageKey = 'dela.workspace.collapsed';

type Store = {
  narrow: boolean;
  collapsed: boolean;
  /** 窄屏抽屉开合；宽屏忽略。 */
  mobileOpen: boolean;
  setCollapsed: (collapsed: boolean) => void;
  setMobileOpen: (open: boolean) => void;
};

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(collapsedStorageKey) === 'true';
  } catch {
    return false;
  }
}

export const useExplorerState = create<Store>((set) => ({
  narrow: typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  collapsed: storedCollapsed(),
  mobileOpen: false,
  setCollapsed: (collapsed) => {
    set({ collapsed });
    try {
      localStorage.setItem(collapsedStorageKey, String(collapsed));
    } catch {
      /* localStorage 不可用时保持内存值。 */
    }
  },
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
}));

/** 目录侧栏当前是否隐藏：窄屏看抽屉，宽屏看折叠。 */
export function selectExplorerHidden(state: {
  narrow: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
}): boolean {
  return state.narrow ? !state.mobileOpen : state.collapsed;
}

// 媒体查询镜像 + 窄屏切换时收起抽屉残留（否则折叠目录后缩窗会永远打不开目录）。
if (typeof window !== 'undefined') {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener('change', () => {
    const narrow = media.matches;
    useExplorerState.setState(narrow ? { narrow } : { narrow, mobileOpen: false });
  });
}

/** 目录隐藏时的展开入口：出现在焦点组标签栏左端（视线引导，替代旧 TitleBar 右上角）。 */
export function ExplorerRevealButton({ className }: { className?: string }) {
  const hidden = useExplorerState(selectExplorerHidden);
  if (!hidden) return null;
  return (
    <button
      aria-label="展开目录"
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground',
        className,
      )}
      onClick={() => {
        const state = useExplorerState.getState();
        if (state.narrow) state.setMobileOpen(true);
        else state.setCollapsed(false);
      }}
      title="展开目录"
      type="button"
    >
      <PanelLeft className="size-4" strokeWidth={1.8} />
    </button>
  );
}
