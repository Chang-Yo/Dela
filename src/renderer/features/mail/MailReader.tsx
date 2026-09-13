import { Paperclip, Reply, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import type { MailMessageDetail, MailAttachmentInfo } from '../../../shared/api';
import { formatMailAddress, formatFullDate, formatSize } from './mail-format';
import { MailHtmlBody } from './MailHtmlBody';
import { cn } from '../../lib/utils';

type Props = {
  className?: string;
  detail: MailMessageDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  selectedMessageId: number | null;
  openMessage: (id: number, options?: { readonly?: boolean }) => Promise<void>;
  downloadAttachment: (messageId: number, part: string) => Promise<{ ok: boolean; error?: string }>;
  onReply: (detail: MailMessageDetail) => void;
  /** 移入本地回收站;readOnly 上下文(回收站阅读)不显示该按钮。 */
  onDelete: (detail: MailMessageDetail) => void;
  /** 只读阅读(回收站):隐藏回复与删除按钮,重试时不标记已读。 */
  readOnly?: boolean;
  /** 单栏态(列表/详情二选一)时显示"返回列表"按钮。 */
  showBackButton?: boolean;
  setMobileReading: (reading: boolean) => void;
};

export function MailReader({
  className,
  detail,
  detailLoading,
  detailError,
  selectedMessageId,
  openMessage,
  downloadAttachment,
  onReply,
  onDelete,
  readOnly = false,
  showBackButton = false,
  setMobileReading,
}: Props) {
  const [downloadingPart, setDownloadingPart] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  useEffect(() => {
    setAttachmentError(null);
    setDownloadingPart(null);
  }, [detail?.id]);

  const saveAttachment = async (attachment: MailAttachmentInfo) => {
    if (!detail || !attachment.part) return;
    setDownloadingPart(attachment.part);
    setAttachmentError(null);
    try {
      const result = await downloadAttachment(detail.id, attachment.part);
      if (!result.ok) setAttachmentError(result.error ?? '附件下载失败');
    } finally {
      setDownloadingPart(null);
    }
  };

  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col bg-muted/30', className)}>
      <button
        className={cn(
          'mx-4 mt-3 items-center self-start rounded-full border px-3 py-1 text-xs text-foreground/80 transition-colors hover:bg-muted',
          showBackButton ? 'inline-flex' : 'hidden',
        )}
        onClick={() => setMobileReading(false)}
        type="button"
      >
        ← 返回列表
      </button>
      {detailLoading && <p className="m-auto text-sm text-muted-foreground">正在获取正文…</p>}
      {!detailLoading && !detail && !detailError && (
        <p className="m-auto text-sm text-muted-foreground">选择一封邮件查看正文</p>
      )}
      {!detailLoading && detailError && !detail && (
        <div className="m-auto grid place-items-center gap-3 text-center text-sm text-destructive">
          <p>{detailError}</p>
          {selectedMessageId !== null && (
            <Button
              onClick={() =>
                void openMessage(selectedMessageId, readOnly ? { readonly: true } : undefined)
              }
              size="sm"
              variant="ghost"
            >
              重试
            </Button>
          )}
        </div>
      )}
      {!detailLoading && detail && (
        <article className="flex min-h-0 flex-1 flex-col overflow-hidden px-8 pt-6 pb-0 max-md:px-4 max-md:pt-2 max-md:pb-0">
          <div className="mx-auto flex w-full max-w-[760px] min-h-0 flex-1 flex-col">
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-[21px] font-semibold leading-7 tracking-tight">
                {detail.subject ?? '(无主题)'}
              </h2>
              {!readOnly && (
                <>
                  <Button
                    aria-label="回复"
                    onClick={() => onReply(detail)}
                    size="icon-sm"
                    title="回复"
                    variant="ghost"
                  >
                    <Reply className="size-4" strokeWidth={1.8} />
                  </Button>
                  <Button
                    aria-label="删除"
                    onClick={() => onDelete(detail)}
                    size="icon-sm"
                    title="删除"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" strokeWidth={1.8} />
                  </Button>
                </>
              )}
            </div>
            <div className="mt-3 grid gap-1.5 border-b border-border/50 pb-4">
              <div className="flex gap-3">
                <span className="w-14 shrink-0 text-xs leading-5 text-muted-foreground">
                  发件人
                </span>
                <span className="min-w-0 flex-1 break-all text-[13px] leading-5">
                  {detail.sender
                    ? formatMailAddress(detail.sender.name, detail.sender.address)
                    : '(未知发件人)'}
                </span>
              </div>
              {detail.to.length > 0 && (
                <div className="flex gap-3">
                  <span className="w-14 shrink-0 text-xs leading-5 text-muted-foreground">
                    收件人
                  </span>
                  <span className="min-w-0 flex-1 break-all text-[13px] leading-5">
                    {detail.to.map((to) => formatMailAddress(to.name, to.address)).join(', ')}
                  </span>
                </div>
              )}
              {detail.cc.length > 0 && (
                <div className="flex gap-3">
                  <span className="w-14 shrink-0 text-xs leading-5 text-muted-foreground">
                    抄送
                  </span>
                  <span className="min-w-0 flex-1 break-all text-[13px] leading-5">
                    {detail.cc.map((cc) => formatMailAddress(cc.name, cc.address)).join(', ')}
                  </span>
                </div>
              )}
              <div className="flex gap-3">
                <span className="w-14 shrink-0 text-xs leading-5 text-muted-foreground">时间</span>
                <span className="min-w-0 flex-1 break-all text-[13px] leading-5">
                  {formatFullDate(detail.date)}
                </span>
              </div>
              {detail.attachments.length > 0 && (
                <div className="flex gap-3">
                  <span className="w-14 shrink-0 text-xs leading-5 text-muted-foreground">
                    附件 {detail.attachments.length}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {detail.attachments.map((attachment: MailAttachmentInfo) => (
                      <button
                        className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-left text-xs transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                        disabled={!attachment.part || downloadingPart === attachment.part}
                        key={`${attachment.filename}-${attachment.part}`}
                        onClick={() => void saveAttachment(attachment)}
                        title={
                          attachment.part ? `保存 ${attachment.filename}` : '请先同步邮件后下载'
                        }
                        type="button"
                      >
                        <Paperclip
                          className="size-3 shrink-0 text-muted-foreground"
                          strokeWidth={1.8}
                        />
                        <span className="truncate">{attachment.filename}</span>
                        {attachment.size !== null && (
                          <span className="shrink-0 text-muted-foreground">
                            {formatSize(attachment.size)}
                          </span>
                        )}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>
            {attachmentError && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {attachmentError}
              </p>
            )}
            {detailError && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {detailError}
              </p>
            )}
            {detail.bodyHtml ? (
              <MailHtmlBody key={detail.id} html={detail.bodyHtml} text={detail.bodyText} />
            ) : (
              <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-t-lg border-x border-t p-4 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                {detail.bodyText ?? '(无正文)'}
              </div>
            )}
          </div>
        </article>
      )}
    </section>
  );
}
