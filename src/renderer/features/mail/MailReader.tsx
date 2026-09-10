import { Button } from '../../components/Button';
import type { MailMessageDetail, MailAttachmentInfo } from '../../../shared/api';
import { formatMailAddress, formatFullDate, formatSize } from './mail-format';
import { MailHtmlBody } from './MailHtmlBody';
import styles from './MailView.module.css';

type Props = {
  detail: MailMessageDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  selectedMessageId: number | null;
  openMessage: (id: number) => Promise<void>;
  setMobileReading: (reading: boolean) => void;
};
export function MailReader({
  detail,
  detailLoading,
  detailError,
  selectedMessageId,
  openMessage,
  setMobileReading,
}: Props) {
  return (
    <section className={styles.readingPane}>
      <button className={styles.backButton} onClick={() => setMobileReading(false)} type="button">
        ← 返回列表
      </button>
      {detailLoading && <p className={styles.readingHint}>正在获取正文…</p>}
      {!detailLoading && !detail && !detailError && (
        <p className={styles.readingHint}>选择一封邮件查看正文</p>
      )}
      {!detailLoading && detailError && !detail && (
        <div className={styles.readingError}>
          <p>{detailError}</p>
          {selectedMessageId !== null && (
            <Button onClick={() => void openMessage(selectedMessageId)} variant="quiet">
              重试
            </Button>
          )}
        </div>
      )}
      {!detailLoading && detail && (
        <article className={styles.readingContent}>
          <h2 className={styles.readingSubject}>{detail.subject ?? '(无主题)'}</h2>
          <div className={styles.readingMeta}>
            <div>
              <span>发件人</span>
              <strong>
                {detail.sender
                  ? formatMailAddress(detail.sender.name, detail.sender.address)
                  : '(未知发件人)'}
              </strong>
            </div>
            {detail.to.length > 0 && (
              <div>
                <span>收件人</span>
                <strong>
                  {detail.to.map((to) => formatMailAddress(to.name, to.address)).join(', ')}
                </strong>
              </div>
            )}
            {detail.cc.length > 0 && (
              <div>
                <span>抄送</span>
                <strong>
                  {detail.cc.map((cc) => formatMailAddress(cc.name, cc.address)).join(', ')}
                </strong>
              </div>
            )}
            <div>
              <span>时间</span>
              <strong>{formatFullDate(detail.date)}</strong>
            </div>
            {detail.attachments.length > 0 && (
              <div>
                <span>附件 {detail.attachments.length}</span>
                <strong className={styles.attachmentList}>
                  {detail.attachments.map((attachment: MailAttachmentInfo) => (
                    <span className={styles.attachmentChip} key={attachment.filename}>
                      {attachment.filename}
                      {attachment.size !== null && ` · ${formatSize(attachment.size)}`}
                    </span>
                  ))}
                </strong>
              </div>
            )}
          </div>
          {detailError && <p className={styles.readingNotice}>{detailError}</p>}
          {detail.bodyHtml ? (
            <MailHtmlBody key={detail.id} html={detail.bodyHtml} text={detail.bodyText} />
          ) : (
            <div className={styles.plainBody}>{detail.bodyText ?? '(无正文)'}</div>
          )}
        </article>
      )}
    </section>
  );
}
