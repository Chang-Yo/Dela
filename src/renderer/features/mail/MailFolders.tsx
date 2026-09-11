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
import { cn } from '../../lib/utils';

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
    <aside
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/70 max-md:flex-row max-md:items-center max-md:gap-2 max-md:border-r-0 max-md:border-b max-md:p-2',
        foldersCollapsed ? 'items-stretch' : '',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 p-2 max-md:hidden',
          foldersCollapsed && 'justify-center',
        )}
      >
        <button
          aria-controls="mail-folders"
          aria-expanded={!foldersCollapsed}
          aria-label={foldersCollapsed ? '展开邮件文件夹' : '收起邮件文件夹'}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setFoldersCollapsed((collapsed) => !collapsed)}
          title={foldersCollapsed ? '展开邮件文件夹' : '收起邮件文件夹'}
          type="button"
        >
          {foldersCollapsed ? (
            <PanelLeftOpen className="size-4" strokeWidth={1.8} />
          ) : (
            <PanelLeftClose className="size-4" strokeWidth={1.8} />
          )}
        </button>
        {!foldersCollapsed && (
          <div className="grid min-w-0 gap-0.5">
            <span className="truncate text-[13px] font-medium leading-4">
              {account?.address ?? '未配置'}
            </span>
            <span className="text-[11px] leading-3.5 text-muted-foreground">
              {selectedFolder?.unread ?? 0} 封未读（当前文件夹）
            </span>
          </div>
        )}
      </div>
      <nav
        aria-label="邮件文件夹"
        className={cn(
          'grid content-start gap-0.5 overflow-y-auto overflow-x-hidden p-2 max-md:flex max-md:flex-row max-md:items-center max-md:overflow-x-auto max-md:p-0 max-md:[scrollbar-width:none]',
          foldersCollapsed && 'px-1.5 max-md:hidden',
        )}
        id="mail-folders"
      >
        {!foldersCollapsed && folders.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            {sync?.phase === 'error' ? '同步失败，暂无文件夹' : '正在获取文件夹…'}
          </p>
        )}
        {folders.map((folder) => {
          const Icon = FOLDER_ICONS[folder.specialUse ?? ''] ?? Folder;
          const hasUnread = folder.unread !== null && folder.unread > 0;
          const selected = folder.id === selectedFolderId;
          return (
            <button
              aria-current={selected ? 'page' : undefined}
              aria-label={`${folder.name}${hasUnread ? `，${folder.unread} 封未读` : ''}`}
              className={cn(
                'relative flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                foldersCollapsed && 'w-8 justify-center px-0',
                selected
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground',
              )}
              key={folder.id}
              onClick={() => onSelect(folder.id)}
              title={foldersCollapsed ? folder.name : undefined}
              type="button"
            >
              <Icon
                className={cn('size-4 shrink-0', selected ? '' : 'text-muted-foreground')}
                strokeWidth={1.8}
              />
              {!foldersCollapsed && (
                <>
                  <span className="truncate">{folder.name}</span>
                  {hasUnread && (
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {folder.unread}
                    </span>
                  )}
                </>
              )}
              {foldersCollapsed && hasUnread && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-foreground"
                />
              )}
            </button>
          );
        })}
      </nav>
      <div className={cn('mt-auto p-2 max-md:hidden', foldersCollapsed && 'p-1')}>
        <button
          aria-label={confirmingDisconnect ? '再点一次确认退出' : '退出登录'}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
            confirmingDisconnect
              ? 'font-medium text-destructive'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-destructive',
            foldersCollapsed && 'mx-auto grid size-8 place-items-center p-0',
          )}
          onClick={() => void handleDisconnect()}
          title={
            foldersCollapsed ? (confirmingDisconnect ? '再点一次确认退出' : '退出登录') : undefined
          }
          type="button"
        >
          <LogOut className="size-3.5 shrink-0" strokeWidth={1.8} />
          {!foldersCollapsed && (confirmingDisconnect ? '再点一次确认退出' : '退出登录')}
        </button>
      </div>
    </aside>
  );
}
