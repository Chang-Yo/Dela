import { CircleArrowUp } from 'lucide-react';
import { useNavigationStore } from '../../navigation/view';
import { useUpdateState, pendingUpdate } from './update';
import { IconButton } from '../../../ui/icon-button';

/**
 * 排在标题栏左侧这一组的最右端：它是状态提示，插进前进/后退中间会把导航按钮拆散。
 * 颜色取 token 里的 --success，与「已连接」「可用」等正向状态同一个绿，不另起色值。
 */
export function UpdateBadge() {
  const snapshot = useUpdateState((state) => state.snapshot);
  if (!snapshot || !pendingUpdate(snapshot)) return null;

  return (
    <IconButton
      className="[-webkit-app-region:no-drag] ml-2 text-success hover:text-success"
      aria-label="有可用的更新"
      onClick={() => useNavigationStore.getState().openSettings('general')}
      title="有可用的更新"
    >
      <CircleArrowUp strokeWidth={1.8} />
    </IconButton>
  );
}
