// 组工具栏（计划 §4.3「当前工作组」作用范围）：分屏方向、最大化/还原、组菜单。
// 常驻按钮保持稳定位置；低频操作进菜单。
import { Columns2, Ellipsis, Maximize2, Minimize2, Rows2, X } from 'lucide-react';
import type { GroupNode } from '../../shared/layout';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useWorkbenchLayout } from './layout-store';

export function GroupToolbar({ group }: { group: GroupNode }) {
  const maximized = useWorkbenchLayout((s) => s.maximized);
  const splitGroup = useWorkbenchLayout((s) => s.splitGroup);
  const setMaximized = useWorkbenchLayout((s) => s.setMaximized);
  const closeTabs = useWorkbenchLayout((s) => s.closeTabs);
  const isMaximized = maximized === group.id;
  return (
    <div className="flex shrink-0 items-center gap-0.5 self-end pb-1">
      <Button
        size="icon-xs"
        variant="ghost"
        className="hover:bg-foreground/10"
        aria-label="向右分屏"
        title="向右分屏"
        onClick={() => splitGroup(group.id, 'vertical')}
      >
        <Columns2 />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        className="hover:bg-foreground/10"
        aria-label="向下分屏"
        title="向下分屏"
        onClick={() => splitGroup(group.id, 'horizontal')}
      >
        <Rows2 />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        className="hover:bg-foreground/10"
        aria-label={isMaximized ? '还原布局' : '最大化此组'}
        title={isMaximized ? '还原布局' : '最大化此组'}
        onClick={() => setMaximized(isMaximized ? null : group.id)}
      >
        {isMaximized ? <Minimize2 /> : <Maximize2 />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            className="hover:bg-foreground/10"
            aria-label="组操作"
            title="组操作"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => closeTabs(group.id, 'all')}>
            <X />
            关闭全部标签
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
