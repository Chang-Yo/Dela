import { CircleArrowUp } from 'lucide-react';
import { useNavigationStore } from '../../navigation/view';
import { cn } from '../../lib/utils';
import { chromeIconButton } from '../../navigation/nav-styles';
import { useUpdateState, pendingUpdate } from './update';

/**
 * 排在标题栏左侧这一组的最右端：它是状态提示，插进前进/后退中间会把导航按钮拆散。
 * 颜色取 token 里的 --green，与「已连接」「可用」等正向状态同一个绿，不另起色值。
 */
export function UpdateBadge() {
  const snapshot = useUpdateState((state) => state.snapshot);
  if (!snapshot || !pendingUpdate(snapshot)) return null;

  return (
    <button
      // tailwind-merge 会把 chromeIconButton 里的 text-ink-3 / hover:text-ink 换成绿色。
      className={cn(
        chromeIconButton,
        '[-webkit-app-region:no-drag] ml-2 text-green hover:text-green',
      )}
      aria-label="有可用的更新"
      onClick={() => useNavigationStore.getState().openSettings('general')}
      title="有可用的更新"
      type="button"
    >
      <CircleArrowUp className="size-4" strokeWidth={1.8} />
    </button>
  );
}
