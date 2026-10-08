// 常驻只保留左右分屏；向下分屏与关闭等低频操作收进组菜单。
import { memo } from 'react';
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

export const GroupToolbar = memo(function GroupToolbar({ group }: { group: GroupNode }) {
  const isMaximized = useWorkbenchLayout((s) => s.maximized === group.id);
  const splitGroup = useWorkbenchLayout((s) => s.splitGroup);
  const setMaximized = useWorkbenchLayout((s) => s.setMaximized);
  const closeTabs = useWorkbenchLayout((s) => s.closeTabs);
  if (!group.active) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5 self-end pb-1">
      <Button
        size="icon-xs"
        variant="ghost"
        className="hover:bg-hover-2 @max-[220px]:hidden"
        aria-label="向右分屏"
        title="向右分屏"
        onClick={() => splitGroup(group.id, 'vertical')}
      >
        <Columns2 />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label="组操作" title="组操作">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => splitGroup(group.id, 'horizontal')}>
            <Rows2 />
            向下分屏
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMaximized(isMaximized ? null : group.id)}>
            {isMaximized ? <Minimize2 /> : <Maximize2 />}
            {isMaximized ? '还原布局' : '最大化此组'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => closeTabs(group.id, 'all')}>
            <X />
            关闭全部标签
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
