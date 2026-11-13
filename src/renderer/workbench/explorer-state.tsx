// 工作台目录侧栏的运行时可见性：窄屏抽屉开合 + 窄屏媒体查询镜像；宽屏折叠是偏好，见 preferences。
// 展开入口在最左上组标签栏左侧（空组由 TabGroup 锚定同一坐标），与目录本体共享此 store。
import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { cn } from '../../ui/cn';
import { usePreferences } from '../app/preferences';

const NARROW_QUERY = '(max-width: 767px)';

type Store = {
  narrow: boolean;
  /** 窄屏抽屉开合；宽屏忽略。 */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

export const useExplorerState = create<Store>((set) => ({
  narrow: typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  mobileOpen: false,
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
}));

/** 视口宽度镜像（rAF 合帧的 resize 监听）：壳侧栏与目录侧栏按视口钳制渲染宽度时共用。 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return width;
}

// 媒体查询镜像 + 窄屏切换时收起抽屉残留（否则折叠目录后缩窗会永远打不开目录）。
if (typeof window !== 'undefined') {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener('change', () => {
    const narrow = media.matches;
    useExplorerState.setState(narrow ? { narrow } : { narrow, mobileOpen: false });
  });
}

/** 目录隐藏时的展开入口：出现在最左上组的标签栏左端。 */
export function ExplorerRevealButton({ className }: { className?: string }) {
  const narrow = useExplorerState((s) => s.narrow);
  const mobileOpen = useExplorerState((s) => s.mobileOpen);
  const collapsed = usePreferences((s) => s.workspaceSidebarCollapsed);
  const hidden = narrow ? !mobileOpen : collapsed;
  if (!hidden) return null;
  return (
    <button
      aria-label="展开目录"
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-base hover:bg-hover-2 hover:text-ink',
        className,
      )}
      onClick={() => {
        const state = useExplorerState.getState();
        if (state.narrow) state.setMobileOpen(true);
        else usePreferences.getState().setPreference('workspaceSidebarCollapsed', false);
      }}
      title="展开目录"
      type="button"
    >
      <PanelLeft className="size-4" strokeWidth={1.8} />
    </button>
  );
}
