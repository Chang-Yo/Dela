import { LayoutGrid, SquarePen } from 'lucide-react';
import { Button } from '../components/ui/button';

/** 组空态：中央提示可拖入标签，并提供「新建对话」（与侧栏同一入口，回调由装配层注入）。
 *  窄组按容器查询降级（容器标记在 TabGroup 根 section）：≤280px 收起副文案；≤180px 再缩
 *  图标、主文案单行超宽省略，避免 CJK 文案在极窄组里竖排逐字换行。目录折叠时的展开入口
 *  由 TabGroup 锚定在标签栏位置，不进本居中栈。 */
export function EmptyState({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-13 text-ink-3">
      <LayoutGrid className="size-7 opacity-45 @max-[180px]:size-5" />
      <p className="@max-[180px]:max-w-full @max-[180px]:truncate @max-[180px]:text-xs">
        此组没有打开的标签
      </p>
      <p className="text-xs text-ink-3/80 @max-[280px]:hidden">拖动标签到此组，或从导航打开内容</p>
      <Button className="mt-1" onClick={onNewChat} size="sm" variant="secondary">
        <SquarePen className="size-3.5" />
        新建对话
      </Button>
    </div>
  );
}
