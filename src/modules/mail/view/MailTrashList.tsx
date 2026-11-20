import { Paperclip, RotateCcw, Trash2 } from 'lucide-react';
import type { MailTrashItem } from '../contract';
import { senderLabel, formatMailDate } from './mail-format';
import { cn } from '../../../ui/lib/cn';
import { PanelHeader } from '../../../ui/panel-header';
import { ErrorText } from '../../../ui/error-text';
import { IconButton } from '../../../ui/icon-button';

type Props = {
  className?: string;
  items: MailTrashItem[];
  loading: boolean;
  error: string | null;
  selectedMessageId: number | null;
  onOpen: (id: number) => void;
  onRestore: (item: MailTrashItem) => void;
  onPurge: (item: MailTrashItem) => void;
  onEmpty: () => void;
};

export function MailTrashList({
  className,
  items,
  loading,
  error,
  selectedMessageId,
  onOpen,
  onRestore,
  onPurge,
  onEmpty,
}: Props) {
  return (
    <section aria-label="已删除邮件" className={cn('flex min-h-0 flex-col', className)}>
      <PanelHeader size="lg">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <strong className="truncate text-sm">已删除</strong>
          <small className="shrink-0 text-xs text-ink-3">{items.length} 封</small>
        </div>
        <div className="flex-1" />
        <IconButton
          aria-label="清空已删除邮件"
          className="hover:text-danger disabled:cursor-wait"
          disabled={items.length === 0}
          onClick={onEmpty}
          title="清空已删除邮件"
        >
          <Trash2 strokeWidth={1.8} />
        </IconButton>
      </PanelHeader>
      {error && <ErrorText className="px-4 py-2">{error}</ErrorText>}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1">
        {loading && <p className="p-4 text-xs text-ink-3">加载中…</p>}
        {!loading && items.length === 0 && <p className="p-4 text-xs text-ink-3">回收站为空</p>}
        {!loading &&
          items.map((item) => {
            const selected = item.id === selectedMessageId;
            return (
              <div
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-card px-2.5 py-2 transition-colors duration-base',
                  selected ? 'bg-selected' : 'hover:bg-hover',
                )}
                key={item.id}
              >
                <button
                  className="grid min-w-0 flex-1 gap-0.5 text-left"
                  onClick={() => onOpen(item.id)}
                  type="button"
                >
                  <span className="flex min-w-0 items-baseline justify-between gap-3">
                    <strong
                      className={cn(
                        'min-w-0 truncate text-sm',
                        item.seen ? 'font-normal text-ink-2' : 'font-semibold',
                      )}
                    >
                      {senderLabel(item)}
                    </strong>
                    <span className="shrink-0 text-xs text-ink-3">{formatMailDate(item.date)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 overflow-hidden">
                    <span
                      className={cn('truncate text-sm', item.seen ? 'text-ink-2' : 'font-medium')}
                    >
                      {item.subject ?? '(无主题)'}
                    </span>
                    {item.hasAttachments && (
                      <Paperclip
                        aria-label="含附件"
                        className="size-3 shrink-0 text-ink-3"
                        strokeWidth={1.8}
                      />
                    )}
                    <span className="min-w-0 truncate text-xs text-ink-3">
                      {item.folderName ?? '未知文件夹'}
                    </span>
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-1 pt-0.5">
                  <IconButton
                    aria-label={`恢复到 ${item.folderName ?? '原文件夹'}`}

                    onClick={() => onRestore(item)}
                    title={`恢复到 ${item.folderName ?? '原文件夹'}`}
                  >
                    <RotateCcw strokeWidth={1.8} />
                  </IconButton>
                  <IconButton
                    aria-label="彻底删除"
                    className="hover:text-danger"
                    onClick={() => onPurge(item)}
                    title="彻底删除"
                  >
                    <Trash2 strokeWidth={1.8} />
                  </IconButton>
                </span>
              </div>
            );
          })}
      </div>
    </section>
  );
}
