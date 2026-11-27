import { LayoutGrid, SquarePen } from 'lucide-react';
import { Button } from '../../../ui/button';
import { EmptyState } from '../../../ui/empty-state';

export function GroupEmptyState({ onNewChat }: { onNewChat: () => void }) {
  return (
    <EmptyState
      action={
        <Button onClick={onNewChat} size="sm" variant="secondary">
          <SquarePen className="size-3.5" />
          新建对话
        </Button>
      }
      className="min-h-0 flex-1 @max-[180px]:[&>svg]:size-5 @max-[180px]:[&>p:first-of-type]:max-w-full @max-[180px]:[&>p:first-of-type]:truncate @max-[180px]:[&>p:first-of-type]:text-xs @max-[280px]:[&>p:nth-of-type(2)]:hidden"
      description="拖动标签到此组，或从导航打开内容"
      icon={LayoutGrid}
      title="此组没有打开的标签"
    />
  );
}
