import { Paperclip, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { MailFolderInfo, MailMessageSummary } from '../contract';
import { senderLabel, formatMailDate } from './mail-format';
import { cn } from '../../../ui/lib/cn';
import { PanelHeader } from '../../../ui/panel-header';
import { Shimmer } from '../../../ui/shimmer';
import { Input } from '../../../ui/input';
import { IconButton } from '../../../ui/icon-button';

type Props = {
  className?: string;
  selectedFolder: MailFolderInfo | null;
  filteredMessages: MailMessageSummary[];
  selectedMessageId: number | null;
  listLoading: boolean;
  search: string;
  setSearch: (value: string) => void;
  syncBusy: boolean;
  syncLabel: string;
  onSync: () => Promise<void>;
  onSelect: (id: number) => void;
};

export function MailMessageList({
  className,
  selectedFolder,
  filteredMessages,
  selectedMessageId,
  listLoading,
  search,
  setSearch,
  syncBusy,
  syncLabel,
  onSync,
  onSelect,
}: Props) {
  const [refreshRequested, setRefreshRequested] = useState(false);
  const spinning = syncBusy || refreshRequested;

  const refresh = () => {
    setRefreshRequested(true);
    // 同步开始的状态推送先于 sync() 返回，此时 syncBusy 已接手转圈。
    Promise.resolve(onSync()).finally(() => setRefreshRequested(false));
  };

  return (
    <section className={cn('flex min-h-0 flex-col', className)}>
      <PanelHeader size="lg">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <strong className="truncate text-sm font-semibold text-ink">
            {selectedFolder?.name ?? '邮件'}
          </strong>
          <small className="shrink-0 truncate text-xs tabular-nums text-ink-3">
            {`${filteredMessages.length} 封`}
          </small>
        </div>
        <div className="flex-1" />
        <IconButton
          aria-label="同步邮件"
          className="disabled:cursor-wait"
          disabled={spinning}
          onClick={refresh}
          title={syncLabel || '同步邮件'}
        >
          <RefreshCw className={cn(spinning && 'animate-spin')} strokeWidth={1.8} />
        </IconButton>
        <Input
          aria-label="搜索邮件"
          className="h-7 w-32 shrink-0 text-xs max-[1080px]:w-24"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索"
          type="search"
          value={search}
        />
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1">
        {listLoading && (
          <p className="p-4 text-xs">
            <Shimmer>加载中</Shimmer>
          </p>
        )}
        {!listLoading && filteredMessages.length === 0 && (
          <p className="p-4 text-xs text-ink-3">{search ? '没有匹配的邮件' : '此文件夹暂无邮件'}</p>
        )}
        {filteredMessages.map((message) => {
          const selected = message.id === selectedMessageId;
          return (
            <button
              className={cn(
                'flex w-full gap-2.5 rounded-card px-2.5 py-2 text-left transition-colors duration-base',
                selected ? 'bg-selected' : 'hover:bg-hover',
              )}
              key={message.id}
              onClick={() => onSelect(message.id)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-[0.4375rem] size-1.5 shrink-0 rounded-full',
                  message.seen ? 'bg-transparent' : 'bg-accent',
                )}
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <strong
                    className={cn(
                      'min-w-0 truncate text-sm',
                      message.seen ? 'font-normal text-ink-2' : 'font-semibold text-ink',
                    )}
                  >
                    {senderLabel(message)}
                  </strong>
                  <span className="shrink-0 text-xs tabular-nums text-ink-3">
                    {formatMailDate(message.date)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 overflow-hidden">
                  <span
                    className={cn(
                      'truncate text-sm',
                      message.seen ? 'text-ink-2' : 'font-medium text-ink',
                    )}
                  >
                    {message.subject ?? '(无主题)'}
                  </span>
                  {message.hasAttachments && (
                    <Paperclip
                      aria-label="含附件"
                      className="size-3 shrink-0 text-ink-3"
                      strokeWidth={1.8}
                    />
                  )}
                </span>
                <span className="truncate text-xs text-ink-3">{message.snippet ?? ''}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
