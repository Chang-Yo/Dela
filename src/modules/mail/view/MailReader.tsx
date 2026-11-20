import { Paperclip, Reply, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../ui/button';
import type { MailMessageDetail, MailAttachmentInfo, MailAddress } from '../contract';
import { formatMailAddress, formatFullDate, formatSize } from './mail-format';
import { MailHtmlBody } from './MailHtmlBody';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/tooltip';
import { cn } from '../../../ui/lib/cn';
import { showToast } from '../../../ui/toast';
import { errorMessage } from '../../../core/protocol/contract';
import { ErrorText } from '../../../ui/alert';

type Props = {
  className?: string;
  detail: MailMessageDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  accountAddress: string;
  selectedMessageId: number | null;
  openMessage: (id: number, readonly: boolean) => void;
  downloadAttachment: (messageId: number, part: string) => Promise<{ ok: boolean; error?: string }>;
  onReply: (detail: MailMessageDetail) => void;
  onDelete: (detail: MailMessageDetail) => void;
  readOnly?: boolean;
  showBackButton?: boolean;
  setMobileReading: (reading: boolean) => void;
};

function RecipientRow({
  to,
  cc,
  accountAddress,
}: {
  to: readonly MailAddress[];
  cc: readonly MailAddress[];
  accountAddress: string;
}) {
  const accountKey = accountAddress.replace(/\s+/g, '').toLowerCase();
  const self =
    to.find((item) => (item.address ?? '').replace(/\s+/g, '').toLowerCase() === accountKey) ??
    to[0];
  if (!self) return null;
  const foldedCount = to.length + cc.length - 1;
  return (
    <div className="flex gap-3">
      <span className="w-14 shrink-0 text-xs leading-5 text-ink-3">收件人</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm leading-5">
        <span className="break-all">{formatMailAddress(self.name, self.address)}</span>
        {foldedCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="inline-flex items-center rounded-control border border-line px-2 py-0.5 text-xs text-ink-3 transition-colors hover:bg-hover-strong"
                type="button"
              >
                +{foldedCount} 收件者
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-h-64 max-w-80 overflow-y-auto">
              <div className="space-y-2">
                <div className="space-y-0.5">
                  <p className="opacity-70">收件人</p>
                  {to.map((item) => (
                    <p className="break-all" key={`${item.address}-${item.name}`}>
                      {formatMailAddress(item.name, item.address)}
                    </p>
                  ))}
                </div>
                {cc.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="opacity-70">抄送</p>
                    {cc.map((item) => (
                      <p className="break-all" key={`${item.address}-${item.name}`}>
                        {formatMailAddress(item.name, item.address)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </div>
  );
}

export function MailReader({
  className,
  detail,
  detailLoading,
  detailError,
  accountAddress,
  selectedMessageId,
  openMessage,
  downloadAttachment,
  onReply,
  onDelete,
  readOnly = false,
  showBackButton = false,
  setMobileReading,
}: Props) {
  // 按邮件记下载中的附件：切到别的邮件后不再显示旧邮件的下载态。
  const [downloading, setDownloading] = useState<{ messageId: number; part: string } | null>(null);
  const detailId = detail?.id;
  const downloadingMessageId = downloading?.messageId;
  const downloadingPart = downloadingMessageId === detailId ? downloading?.part : null;

  const saveAttachment = async (attachment: MailAttachmentInfo) => {
    if (!detail || !attachment.part) return;
    const part = attachment.part;
    setDownloading({ messageId: detail.id, part });
    const download = async () => {
      const result = await downloadAttachment(detail.id, part);
      if (!result.ok)
        showToast({
          variant: 'error',
          title: '保存附件失败',
          description: result.error ?? '附件下载失败',
        });
    };
    try {
      await download();
    } catch (reason) {
      showToast({ variant: 'error', title: '保存附件失败', description: errorMessage(reason) });
    }
    setDownloading(null);
  };

  return (
    <section className={cn('@container flex min-h-0 min-w-0 flex-col bg-inset', className)}>
      <button
        className={cn(
          'mx-4 mt-3 items-center self-start rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition-colors hover:bg-hover-strong',
          showBackButton ? 'inline-flex' : 'hidden',
        )}
        onClick={() => setMobileReading(false)}
        type="button"
      >
        ← 返回列表
      </button>
      {detailLoading && <p className="m-auto text-sm text-ink-3">正在获取正文…</p>}
      {!detailLoading && !detail && !detailError && (
        <p className="m-auto text-sm text-ink-3">选择一封邮件查看正文</p>
      )}
      {!detailLoading && detailError && !detail && (
        <div className="m-auto grid place-items-center gap-3 text-center text-sm text-danger">
          <p>{detailError}</p>
          {selectedMessageId !== null && (
            <Button
              onClick={() => openMessage(selectedMessageId, readOnly)}
              size="sm"
              variant="ghost"
            >
              重试
            </Button>
          )}
        </div>
      )}
      {!detailLoading && detail && (
        <article className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-0 @min-[520px]:px-8 max-md:pt-2 max-md:pb-0">
          <div className="mx-auto flex w-full max-w-190 flex-col">
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 break-words text-xl font-semibold leading-7 tracking-tight">
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
            <div className="mt-3 grid gap-1.5 border-b border-line pb-4">
              <div className="flex gap-3">
                <span className="w-14 shrink-0 text-xs leading-5 text-ink-3">发件人</span>
                <span className="min-w-0 flex-1 break-all text-sm leading-5">
                  {detail.sender
                    ? formatMailAddress(detail.sender.name, detail.sender.address)
                    : '(未知发件人)'}
                </span>
              </div>
              {detail.to.length > 0 && (
                <RecipientRow accountAddress={accountAddress} cc={detail.cc} to={detail.to} />
              )}
              {detail.to.length === 0 && detail.cc.length > 0 && (
                <div className="flex gap-3">
                  <span className="w-14 shrink-0 text-xs leading-5 text-ink-3">抄送</span>
                  <span className="min-w-0 flex-1 break-all text-sm leading-5">
                    {detail.cc.map((cc) => formatMailAddress(cc.name, cc.address)).join(', ')}
                  </span>
                </div>
              )}
              <div className="flex gap-3">
                <span className="w-14 shrink-0 text-xs leading-5 text-ink-3">时间</span>
                <span className="min-w-0 flex-1 break-all text-sm leading-5">
                  {formatFullDate(detail.date)}
                </span>
              </div>
              {detail.attachments.length > 0 && (
                <div className="flex gap-3">
                  <span className="w-14 shrink-0 text-xs leading-5 text-ink-3">
                    附件 {detail.attachments.length}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {detail.attachments.map((attachment: MailAttachmentInfo) => (
                      <button
                        className="inline-flex max-w-full items-center gap-1 rounded-control border border-line px-2 py-0.5 text-left text-xs transition-colors hover:bg-hover-strong disabled:cursor-wait disabled:opacity-60"
                        disabled={!attachment.part || downloadingPart === attachment.part}
                        key={`${attachment.filename}-${attachment.part}`}
                        onClick={() => void saveAttachment(attachment)}
                        title={
                          attachment.part ? `保存 ${attachment.filename}` : '请先同步邮件后下载'
                        }
                        type="button"
                      >
                        <Paperclip className="size-3 shrink-0 text-ink-3" strokeWidth={1.8} />
                        <span className="truncate">{attachment.filename}</span>
                        {attachment.size !== null && (
                          <span className="shrink-0 text-ink-3">{formatSize(attachment.size)}</span>
                        )}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>
            {detailError && <ErrorText className="mt-2">{detailError}</ErrorText>}
            {detail.bodyHtml ? (
              <MailHtmlBody key={detail.id} html={detail.bodyHtml} text={detail.bodyText} />
            ) : (
              <div className="mt-3 rounded-t-card border-x border-t p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {detail.bodyText ?? '(无正文)'}
              </div>
            )}
          </div>
        </article>
      )}
    </section>
  );
}
