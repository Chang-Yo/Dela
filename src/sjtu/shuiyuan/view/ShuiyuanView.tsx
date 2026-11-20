import { useState } from 'react';
import { PencilLine } from 'lucide-react';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/lib/cn';
import { DesktopOnlyNotice } from '../../../ui/desktop-only-notice';
import { drawerFromRight } from '../../../ui/lib/motion';
import { BindCard } from './BindCard';
import { NewMessageDialog } from './NewMessageDialog';
import { BookmarkList, ListBackButton, NotificationList } from './PersonalLists';
import { ShuiyuanHeader } from './ShuiyuanHeader';
import { TopicReader, TopicReaderHeader } from './TopicReader';
import { TopicFeed } from './TopicFeed';
import { useShuiyuan } from './store';
import { useShuiyuanState } from './use-shuiyuan';

export function ShuiyuanView() {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="水源的授权密钥只在主进程保存和使用，不会暴露给浏览器。"
        title="水源仅在 Dela 桌面端可用"
      />
    );
  }
  return <DesktopShuiyuanView />;
}

function DesktopShuiyuanView() {
  const state = useShuiyuanState();
  const list = useShuiyuan((state) => state.list);
  const reading = useShuiyuan((state) => state.reading);
  const [messageOpen, setMessageOpen] = useState(false);

  if (!state.data && state.errorUpdateCount === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-3">正在读取绑定状态…</div>
    );
  }
  if (!state.data?.connected) return <BindCard />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {reading ? <TopicReaderHeader reading={reading} /> : <ShuiyuanHeader />}
      <div className="relative min-h-0 flex-1">
        {/* 信息流常驻挂载：进入阅读页后保留滚动位置，返回即时还原。 */}
        <div aria-hidden={Boolean(reading)} className="absolute inset-0 overflow-y-auto">
          {list.kind === 'bookmarks' ? (
            <BookmarkList />
          ) : list.kind === 'notifications' ? (
            <NotificationList />
          ) : (
            <>
              {list.kind === 'messages' ? (
                <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 pb-1 pt-3 max-md:px-3">
                  <ListBackButton />
                  <Button onClick={() => setMessageOpen(true)} size="sm" variant="outline">
                    <PencilLine className="size-3.5" />
                    新私信
                  </Button>
                </div>
              ) : null}
              <TopicFeed list={list} />
            </>
          )}
        </div>
        {reading ? (
          // key 随 topicId 变化：切帖重挂载阅读器，草稿与回复目标按帖子从会话内记忆恢复。
          <div
            className={cn('absolute inset-0 z-10 bg-surface', drawerFromRight)}
            key={reading.topicId}
          >
            <TopicReader reading={reading} />
          </div>
        ) : null}
      </div>
      <NewMessageDialog onOpenChange={setMessageOpen} open={messageOpen} />
    </div>
  );
}
