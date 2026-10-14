import { Paperclip, RotateCcw, Trash2 } from 'lucide-react';
import type { MailTrashItem } from '../../../shared/api';
import { senderLabel, formatMailDate } from './mail-format';
import { cn } from '../../lib/utils';

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

/** 本地回收站列表:行样式沿用 MailMessageList,附恢复/彻底删除操作与头部清空。 */
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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <strong className="truncate text-13">已删除</strong>
          <small className="shrink-0 text-xs text-ink-3">{items.length} 封</small>
        </div>
        <div className="flex-1" />
        <button
          aria-label="清空已删除邮件"
          className="grid size-7 shrink-0 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover-2 hover:text-red disabled:cursor-wait disabled:opacity-50"
          disabled={items.length === 0}
          onClick={onEmpty}
          title="清空已删除邮件"
          type="button"
        >
          <Trash2 className="size-3.5" strokeWidth={1.8} />
        </button>
      </div>
      {error && (
        <p className="px-4 py-2 text-xs text-red" role="alert">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1">
        {loading && <p className="p-4 text-xs text-ink-3">加载中…</p>}
        {!loading && items.length === 0 && <p className="p-4 text-xs text-ink-3">回收站为空</p>}
        {!loading &&
          items.map((item) => {
            const selected = item.id === selectedMessageId;
            return (
              <div
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-card px-2.5 py-2 transition-colors duration-150',
                  selected ? 'bg-hover-2' : 'hover:bg-hover',
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
                        'min-w-0 truncate text-13',
                        item.seen ? 'font-normal text-ink-2' : 'font-semibold',
                      )}
                    >
                      {senderLabel(item)}
                    </strong>
                    <span className="shrink-0 text-2xs text-ink-3">
                      {formatMailDate(item.date)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 overflow-hidden">
                    <span
                      className={cn('truncate text-13', item.seen ? 'text-ink-2' : 'font-medium')}
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
                  <button
                    aria-label={`恢复到 ${item.folderName ?? '原文件夹'}`}
                    className="grid size-7 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
                    onClick={() => onRestore(item)}
                    title={`恢复到 ${item.folderName ?? '原文件夹'}`}
                    type="button"
                  >
                    <RotateCcw className="size-3.5" strokeWidth={1.8} />
                  </button>
                  <button
                    aria-label="彻底删除"
                    className="grid size-7 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover-2 hover:text-red"
                    onClick={() => onPurge(item)}
                    title="彻底删除"
                    type="button"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.8} />
                  </button>
                </span>
              </div>
            );
          })}
      </div>
    </section>
  );
}
