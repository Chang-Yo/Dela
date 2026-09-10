import clsx from 'clsx';
import {
  Archive,
  CircleAlert,
  FilePenLine,
  Folder,
  Inbox,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import type { MailFolderInfo, MailAccountInfo, MailSyncStatus } from '../../../shared/api';
import styles from './MailView.module.css';

const FOLDER_ICONS: Record<string, LucideIcon> = {
  '\\Inbox': Inbox,
  '\\Flagged': Star,
  '\\Drafts': FilePenLine,
  '\\Sent': Send,
  '\\Junk': CircleAlert,
  '\\Trash': Trash2,
  '\\Archive': Archive,
};

type Props = {
  foldersCollapsed: boolean;
  setFoldersCollapsed: (update: (value: boolean) => boolean) => void;
  account: MailAccountInfo | null;
  selectedFolder: MailFolderInfo | null;
  folders: MailFolderInfo[];
  sync: MailSyncStatus | null;
  selectedFolderId: number | null;
  onSelect: (id: number) => void;
  confirmingDisconnect: boolean;
  handleDisconnect: () => Promise<void>;
};
export function MailFolders({
  foldersCollapsed,
  setFoldersCollapsed,
  account,
  selectedFolder,
  folders,
  sync,
  selectedFolderId,
  onSelect,
  confirmingDisconnect,
  handleDisconnect,
}: Props) {
  return (
    <aside className={clsx(styles.folderPane, foldersCollapsed && styles.isCollapsed)}>
      <button
        aria-expanded={!foldersCollapsed}
        aria-controls="mail-folders"
        aria-label={foldersCollapsed ? '展开邮件文件夹' : '收起邮件文件夹'}
        className={styles.folderToggle}
        onClick={() => setFoldersCollapsed((collapsed) => !collapsed)}
        title={foldersCollapsed ? '展开邮件文件夹' : '收起邮件文件夹'}
        type="button"
      >
        {foldersCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
      <div className={styles.accountCard}>
        <span aria-hidden="true" className={styles.accountMark}>
          {(account?.address ?? 'D').charAt(0).toUpperCase()}
        </span>
        <div className={styles.accountInfo}>
          <strong>{account?.address ?? '未配置'}</strong>
          <small>{selectedFolder?.unread ?? 0} 封未读（当前文件夹）</small>
        </div>
      </div>
      <nav id="mail-folders" aria-label="邮件文件夹" className={styles.folderList}>
        {!foldersCollapsed && folders.length === 0 && (
          <p className={styles.folderEmpty}>
            {sync?.phase === 'error' ? '同步失败，暂无文件夹' : '正在获取文件夹…'}
          </p>
        )}
        {folders.map((folder) => {
          const Icon = FOLDER_ICONS[folder.specialUse ?? ''] ?? Folder;
          const hasUnread = folder.unread !== null && folder.unread > 0;
          return (
            <button
              aria-label={`${folder.name}${hasUnread ? `，${folder.unread} 封未读` : ''}`}
              aria-current={folder.id === selectedFolderId ? 'page' : undefined}
              className={clsx(
                styles.folderItem,
                foldersCollapsed && styles.isIconOnly,
                folder.id === selectedFolderId && styles.isSelected,
              )}
              key={folder.id}
              onClick={() => onSelect(folder.id)}
              title={foldersCollapsed ? folder.name : undefined}
              type="button"
            >
              <span aria-hidden="true" className={styles.folderIcon}>
                <Icon size={16} strokeWidth={1.7} />
              </span>
              <span className={styles.folderName}>{folder.name}</span>
              {hasUnread &&
                (foldersCollapsed ? (
                  <span className={styles.unreadPin} />
                ) : (
                  <span className={styles.unreadBadge}>{folder.unread}</span>
                ))}
            </button>
          );
        })}
      </nav>
      <div className={styles.folderFooter}>
        <button
          aria-label={confirmingDisconnect ? '再点一次确认退出' : '退出登录'}
          className={clsx(
            styles.disconnectButton,
            foldersCollapsed && styles.isIconOnly,
            confirmingDisconnect && styles.isConfirming,
          )}
          onClick={() => void handleDisconnect()}
          title={
            foldersCollapsed ? (confirmingDisconnect ? '再点一次确认退出' : '退出登录') : undefined
          }
          type="button"
        >
          {foldersCollapsed ? (
            <LogOut size={16} strokeWidth={1.7} />
          ) : confirmingDisconnect ? (
            '再点一次确认退出'
          ) : (
            '退出登录'
          )}
        </button>
      </div>
    </aside>
  );
}
