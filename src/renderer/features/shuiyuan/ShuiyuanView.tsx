import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PencilLine } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import { BindCard } from './BindCard';
import { NewMessageDialog } from './NewMessageDialog';
import { BookmarkList, ListBackButton, NotificationList } from './PersonalLists';
import { ShuiyuanHeader } from './ShuiyuanHeader';
import { TopicReader, TopicReaderHeader } from './TopicReader';
import { TopicFeed } from './TopicFeed';
import { useShuiyuan } from './store';

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
  const init = useShuiyuan((state) => state.init);
  const connected = useShuiyuan((state) => state.connected);
  const list = useShuiyuan((state) => state.list);
  const reading = useShuiyuan((state) => state.reading);
  const topicRequest = useShuiyuan((state) => state.topicRequest);
  const consumeTopicRequest = useShuiyuan((state) => state.consumeTopicRequest);
  const [ready, setReady] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);

  useEffect(() => {
    void init().finally(() => setReady(true));
  }, [init]);

  // App 层「在水源页打开」请求（项目引用卡片入口）。
  useEffect(() => {
    if (topicRequest) consumeTopicRequest(topicRequest);
  }, [topicRequest, consumeTopicRequest]);

  if (!ready) {
    return (
      <div className="grid h-full place-items-center text-13 text-ink-3">正在读取绑定状态…</div>
    );
  }
  if (!connected) return <BindCard />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 顶部导航原地互换：阅读时直接换为阅读页顶栏，不做动画。 */}
      {reading ? <TopicReaderHeader /> : <ShuiyuanHeader />}
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
              <TopicFeed />
            </>
          )}
        </div>
        <AnimatePresence initial={false}>
          {reading ? (
            // key 随 topicId 变化：切帖重挂载阅读器，重挂载即重置草稿与回复目标。
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="absolute inset-0 z-10 bg-surface"
              exit={{ opacity: 0, x: 24 }}
              initial={{ opacity: 0, x: 24 }}
              key={reading.topicId}
              transition={{ duration: 0.16 }}
            >
              <TopicReader />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <NewMessageDialog onOpenChange={setMessageOpen} open={messageOpen} />
    </div>
  );
}
