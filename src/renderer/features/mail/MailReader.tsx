import { Paperclip, Reply, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import type { MailMessageDetail, MailAttachmentInfo, MailAddress } from '../../../shared/api';
import { formatMailAddress, formatFullDate, formatSize } from './mail-format';
import { MailHtmlBody } from './MailHtmlBody';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { cn } from '../../lib/utils';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';

type Props = {
  className?: string;
  detail: MailMessageDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  /** 当前账户地址,用于在收件人行识别"自己"并折叠其余收件人。 */
  accountAddress: string;
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

/** 收件人行:群发时只显示自己,其余收件人与抄送折叠为"+N 收件者",悬浮展开完整列表。 */
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
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-13 leading-5">
        <span className="break-all">{formatMailAddress(self.name, self.address)}</span>
        {foldedCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="inline-flex items-center rounded-control border border-line px-2 py-0.5 text-xs text-ink-3 transition-colors hover:bg-hover-2"
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
  const [downloadingPart, setDownloadingPart] = useState<string | null>(null);

  useEffect(() => {
    setDownloadingPart(null);
  }, [detail?.id]);

  const saveAttachment = async (attachment: MailAttachmentInfo) => {
    if (!detail || !attachment.part) return;
    setDownloadingPart(attachment.part);
    try {
      const result = await downloadAttachment(detail.id, attachment.part);
      if (!result.ok)
        showToast({
          variant: 'error',
          title: '保存附件失败',
          description: result.error ?? '附件下载失败',
        });
    } catch (reason) {
      showToast({ variant: 'error', title: '保存附件失败', description: errorText(reason) });
    } finally {
      setDownloadingPart(null);
    }
  };

  return (
    // @container 宿主：正文的左右内边距按面板实宽降档（max-md 看窗口宽度，列表拖宽后失效）。
    <section className={cn('@container flex min-h-0 min-w-0 flex-col bg-inset', className)}>
      <button
        className={cn(
          'mx-4 mt-3 items-center self-start rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition-colors hover:bg-hover-2',
          showBackButton ? 'inline-flex' : 'hidden',
        )}
        onClick={() => setMobileReading(false)}
        type="button"
      >
        ← 返回列表
      </button>
      {detailLoading && <p className="m-auto text-13 text-ink-3">正在获取正文…</p>}
      {!detailLoading && !detail && !detailError && (
        <p className="m-auto text-13 text-ink-3">选择一封邮件查看正文</p>
      )}
      {!detailLoading && detailError && !detail && (
        <div className="m-auto grid place-items-center gap-3 text-center text-13 text-red">
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
        <article className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-0 @min-[520px]:px-8 max-md:pt-2 max-md:pb-0">
          <div className="mx-auto flex w-full max-w-[47.5rem] flex-col">
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 break-words text-21 font-semibold leading-7 tracking-tight">
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
            <div className="mt-3 grid gap-1.5 border-b border-line-soft pb-4">
              <div className="flex gap-3">
                <span className="w-14 shrink-0 text-xs leading-5 text-ink-3">发件人</span>
                <span className="min-w-0 flex-1 break-all text-13 leading-5">
                  {detail.sender
                    ? formatMailAddress(detail.sender.name, detail.sender.address)
                    : '(未知发件人)'}
                </span>
              </div>
              {detail.to.length > 0 && (
                <RecipientRow accountAddress={accountAddress} cc={detail.cc} to={detail.to} />
              )}
              {/* 折叠时抄送并入"+N 收件者"悬浮列表;仅当无收件人(无法折叠)时保留独立抄送行。 */}
              {detail.to.length === 0 && detail.cc.length > 0 && (
                <div className="flex gap-3">
                  <span className="w-14 shrink-0 text-xs leading-5 text-ink-3">抄送</span>
                  <span className="min-w-0 flex-1 break-all text-13 leading-5">
                    {detail.cc.map((cc) => formatMailAddress(cc.name, cc.address)).join(', ')}
                  </span>
                </div>
              )}
              <div className="flex gap-3">
                <span className="w-14 shrink-0 text-xs leading-5 text-ink-3">时间</span>
                <span className="min-w-0 flex-1 break-all text-13 leading-5">
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
                        className="inline-flex max-w-full items-center gap-1 rounded-control border border-line px-2 py-0.5 text-left text-xs transition-colors hover:bg-hover-2 disabled:cursor-wait disabled:opacity-60"
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
            {detailError && (
              <p className="mt-2 text-xs text-red" role="alert">
                {detailError}
              </p>
            )}
            {detail.bodyHtml ? (
              <MailHtmlBody key={detail.id} html={detail.bodyHtml} text={detail.bodyText} />
            ) : (
              <div className="mt-3 rounded-t-lg border-x border-t p-4 text-13 leading-relaxed whitespace-pre-wrap break-words">
                {detail.bodyText ?? '(无正文)'}
              </div>
            )}
          </div>
        </article>
      )}
    </section>
  );
}
