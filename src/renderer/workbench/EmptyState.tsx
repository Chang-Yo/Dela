import { LayoutGrid } from 'lucide-react';

/** 组空态：无导航入口（3B 接入），只提示可拖入标签。 */
export function EmptyState() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <LayoutGrid className="size-7 opacity-45" />
      <p>此组没有打开的标签</p>
      <p className="text-xs opacity-75">拖动标签到此组，或从导航打开内容</p>
    </div>
  );
}
