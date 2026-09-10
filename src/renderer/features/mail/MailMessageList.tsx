import clsx from 'clsx';
import type { MailFolderInfo, MailMessageSummary } from '../../../shared/api';
import { senderLabel, formatMailDate } from './mail-format';
import styles from './MailView.module.css';

type Props = {
  selectedFolder: MailFolderInfo | null;
  filteredMessages: MailMessageSummary[];
  selectedMessageId: number | null;
  listLoading: boolean;
  search: string;
  setSearch: (value: string) => void;
  onSelect: (id: number) => void;
};
export function MailMessageList({
  selectedFolder,
  filteredMessages,
  selectedMessageId,
  listLoading,
  search,
  setSearch,
  onSelect,
}: Props) {
  return (
    <section className={styles.listPane}>
      <div className={styles.listToolbar}>
        <div className={styles.listTitle}>
          <strong>{selectedFolder?.name ?? '邮件'}</strong>
          <small>{filteredMessages.length} 封</small>
        </div>
        <input
          aria-label="搜索邮件"
          className={styles.searchInput}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索"
          type="search"
          value={search}
        />
      </div>
      <div className={styles.messageList}>
        {listLoading && <p className={styles.listHint}>加载中…</p>}
        {!listLoading && filteredMessages.length === 0 && (
          <p className={styles.listHint}>{search ? '没有匹配的邮件' : '此文件夹暂无邮件'}</p>
        )}
        {filteredMessages.map((message) => (
          <button
            className={clsx(
              styles.messageRow,
              message.id === selectedMessageId && styles.isSelected,
            )}
            key={message.id}
            onClick={() => onSelect(message.id)}
            type="button"
          >
            <span
              aria-hidden="true"
              className={clsx(styles.unreadDot, message.seen && styles.isSeen)}
            />
            <span className={styles.messageMain}>
              <span className={styles.messageTopRow}>
                <strong className={clsx(!message.seen && styles.isUnread)}>
                  {senderLabel(message)}
                </strong>
                <span className={styles.messageDate}>{formatMailDate(message.date)}</span>
              </span>
              <span className={clsx(styles.messageSubject, !message.seen && styles.isUnread)}>
                {message.subject ?? '(无主题)'}
                {message.hasAttachments && (
                  <span aria-label="含附件" className={styles.attachmentMark}>
                    📎
                  </span>
                )}
              </span>
              <span className={styles.messageSnippet}>{message.snippet ?? ''}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
