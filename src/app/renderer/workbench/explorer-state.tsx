// 工作台目录侧栏的运行时可见性：窄屏媒体查询镜像；抽屉开合在 mobile-drawer，宽屏折叠是偏好，见 preferences。
// 展开入口在最左上组标签栏左侧（空组由 TabGroup 锚定同一坐标），与目录本体共享此 store。
import { create } from 'zustand';
import { PanelLeft } from 'lucide-react';
import { usePreferences } from '../shell/preferences';
import { useMobileDrawer } from '../shell/mobile-drawer';
import { Button } from '../../../ui/button';

const NARROW_QUERY = '(max-width: 767px)';

type Store = {
  narrow: boolean;
};

export const useExplorerState = create<Store>(() => ({
  narrow: typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
}));

if (typeof window !== 'undefined') {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener('change', () => {
    const narrow = media.matches;
    useExplorerState.setState({ narrow });
    if (!narrow) useMobileDrawer.getState().setDrawer(null);
  });
}

export function ExplorerRevealButton({ className }: { className?: string }) {
  const narrow = useExplorerState((s) => s.narrow);
  const mobileOpen = useMobileDrawer((s) => s.drawer === 'explorer');
  const collapsed = usePreferences((s) => s.workspaceSidebarCollapsed);
  const hidden = narrow ? !mobileOpen : collapsed;
  if (!hidden) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="展开目录"
      className={className}
      onClick={() => {
        const state = useExplorerState.getState();
        if (state.narrow) useMobileDrawer.getState().setDrawer('explorer');
        else usePreferences.getState().setPreference('workspaceSidebarCollapsed', false);
      }}
      title="展开目录"
    >
      <PanelLeft strokeWidth={1.8} />
    </Button>
  );
}
