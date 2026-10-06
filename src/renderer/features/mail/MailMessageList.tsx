import { Paperclip, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MailFolderInfo, MailMessageSummary } from '../../../shared/api';
import { senderLabel, formatMailDate } from './mail-format';
import { cn } from '../../lib/utils';

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

  useEffect(() => {
    if (!syncBusy) setRefreshRequested(false);
  }, [syncBusy]);

  const refresh = () => {
    setRefreshRequested(true);
    Promise.resolve(onSync()).catch(() => setRefreshRequested(false));
  };

  return (
    <section className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <strong className="truncate text-sm">{selectedFolder?.name ?? '邮件'}</strong>
          {/* 同步进行中把计数换成进度文案：只有转圈图标时用户不知道在同步什么、进度如何。 */}
          <small
            className="shrink-0 truncate text-xs text-muted-foreground"
            title={syncBusy ? syncLabel : undefined}
          >
            {syncBusy && syncLabel ? syncLabel : `${filteredMessages.length} 封`}
          </small>
        </div>
        <div className="flex-1" />
        <button
          aria-label="同步邮件"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50"
          disabled={spinning}
          onClick={refresh}
          title={syncLabel || '同步邮件'}
          type="button"
        >
          <RefreshCw className={cn('size-3.5', spinning && 'animate-spin')} strokeWidth={1.8} />
        </button>
        <input
          aria-label="搜索邮件"
          className="h-7 w-32 shrink-0 rounded-md border-transparent bg-muted px-2.5 text-xs shadow-none outline-none transition-[background,box-shadow] placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 max-[1080px]:w-24"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索"
          type="search"
          value={search}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {listLoading && <p className="p-4 text-xs text-muted-foreground">加载中…</p>}
        {!listLoading && filteredMessages.length === 0 && (
          <p className="p-4 text-xs text-muted-foreground">
            {search ? '没有匹配的邮件' : '此文件夹暂无邮件'}
          </p>
        )}
        {filteredMessages.map((message) => {
          const selected = message.id === selectedMessageId;
          return (
            <button
              className={cn(
                'flex w-full gap-2.5 border-b border-border/50 px-4 py-2.5 text-left transition-colors',
                selected ? 'bg-muted' : 'hover:bg-muted/50',
              )}
              key={message.id}
              onClick={() => onSelect(message.id)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  message.seen ? 'bg-transparent' : 'bg-foreground',
                )}
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <strong
                    className={cn(
                      'min-w-0 truncate text-[13px]',
                      message.seen ? 'font-normal text-foreground/80' : 'font-semibold',
                    )}
                  >
                    {senderLabel(message)}
                  </strong>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatMailDate(message.date)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 overflow-hidden">
                  <span
                    className={cn(
                      'truncate text-[13px]',
                      message.seen ? 'text-foreground/80' : 'font-medium',
                    )}
                  >
                    {message.subject ?? '(无主题)'}
                  </span>
                  {message.hasAttachments && (
                    <Paperclip
                      aria-label="含附件"
                      className="size-3 shrink-0 text-muted-foreground"
                      strokeWidth={1.8}
                    />
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {message.snippet ?? ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
