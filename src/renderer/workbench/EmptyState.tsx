import { LayoutGrid } from 'lucide-react';

/** 组空态：无导航入口（3B 接入），只提示可拖入标签。窄组按容器查询降级（容器标记在
 *  TabGroup 根 section）：≤280px 收起副文案；≤180px 再缩图标、主文案单行超宽省略，
 *  避免 CJK 文案在极窄组里竖排逐字换行。目录折叠时的展开入口由 TabGroup 锚定在
 *  标签栏位置，不进本居中栈。 */
export function EmptyState() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <LayoutGrid className="size-7 opacity-45 @max-[180px]:size-5" />
      <p className="@max-[180px]:max-w-full @max-[180px]:truncate @max-[180px]:text-xs">
        此组没有打开的标签
      </p>
      <p className="text-xs opacity-75 @max-[280px]:hidden">拖动标签到此组，或从导航打开内容</p>
    </div>
  );
}
