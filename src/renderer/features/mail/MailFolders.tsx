import {
  Archive,
  CircleAlert,
  FilePenLine,
  Folder,
  Inbox,
  LogOut,
  Pencil,
  Send,
  Star,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import type { MailFolderInfo, MailAccountInfo, MailSyncStatus } from '../../../shared/api';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
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
  folders: MailFolderInfo[];
  sync: MailSyncStatus | null;
  selectedFolderId: number | null;
  onSelect: (id: number) => void;
  confirmingDisconnect: boolean;
  handleDisconnect: () => Promise<void>;
  composing: boolean;
  onCompose: () => void;
  /** 窄屏抽屉等场景：隐藏顶部的折叠开关行。 */
  hideHeader?: boolean;
  className?: string;
};

export function MailFolders({
  foldersCollapsed,
  setFoldersCollapsed,
  account,
  folders,
  sync,
  selectedFolderId,
  onSelect,
  confirmingDisconnect,
  handleDisconnect,
  composing,
  onCompose,
  hideHeader = false,
  className,
}: Props) {
  return (
    <aside
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/70',
        foldersCollapsed && 'items-stretch',
        className,
      )}
    >
      {!hideHeader && (
        <div className="flex h-11 shrink-0 items-center p-2">
          <PanelToggleButton
            collapsed={foldersCollapsed}
            controlsId="mail-folders"
            label="邮件文件夹"
            onToggle={() => setFoldersCollapsed((collapsed) => !collapsed)}
          />
        </div>
      )}
      <nav
        aria-label="邮件文件夹"
        className="grid content-start gap-0.5 overflow-y-auto overflow-x-hidden p-2"
        id="mail-folders"
      >
        {folders.length === 0 && (
          <p
            className={cn(
              'whitespace-nowrap p-2 text-xs text-muted-foreground',
              // 文字随折叠淡入/淡出;图标不参与,保持全程原位。
              'transition-opacity duration-150 ease-out',
              foldersCollapsed && 'opacity-0',
            )}
          >
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
              <span
                className={cn(
                  'truncate transition-opacity duration-150 ease-out',
                  foldersCollapsed && 'opacity-0',
                )}
              >
                {folder.name}
              </span>
              {!foldersCollapsed && hasUnread && (
                <span className="ml-auto shrink-0 animate-in fade-in duration-150 text-xs tabular-nums text-muted-foreground">
                  {folder.unread}
                </span>
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
      <div className="mt-auto grid content-start gap-0.5 p-2">
        <button
          aria-current={composing ? 'page' : undefined}
          aria-label="发送邮件"
          className={cn(
            'flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
            composing
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground',
          )}
          onClick={onCompose}
          title={foldersCollapsed ? '发送邮件' : undefined}
          type="button"
        >
          <Pencil
            className={cn('size-4 shrink-0', composing ? '' : 'text-muted-foreground')}
            strokeWidth={1.8}
          />
          <span
            className={cn(
              'truncate transition-opacity duration-150 ease-out',
              foldersCollapsed && 'opacity-0',
            )}
          >
            发送邮件
          </span>
        </button>
        <div aria-hidden="true" className="my-2 border-t border-border/70" />
        <div
          className="flex h-11 min-w-0 items-center gap-2.5 rounded-lg px-2 text-muted-foreground"
          title={account?.address ?? '未配置'}
        >
          <UserRound className="size-4 shrink-0" strokeWidth={1.8} />
          <span
            className={cn(
              'truncate text-sm text-foreground transition-opacity duration-150 ease-out',
              foldersCollapsed && 'opacity-0',
            )}
          >
            {account ? account.address.split('@')[0] : '未配置'}
          </span>
        </div>
        <button
          aria-label={confirmingDisconnect ? '再点一次确认退出' : '退出登录'}
          className={cn(
            'flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
            confirmingDisconnect
              ? 'bg-accent font-medium text-destructive'
              : 'text-foreground/75 hover:bg-accent/60 hover:text-destructive',
          )}
          onClick={() => void handleDisconnect()}
          data-mail-disconnect
          title={
            foldersCollapsed ? (confirmingDisconnect ? '再点一次确认退出' : '退出登录') : undefined
          }
          type="button"
        >
          <LogOut
            className={cn('size-4 shrink-0', confirmingDisconnect ? '' : 'text-muted-foreground')}
            strokeWidth={1.8}
          />
          <span
            className={cn(
              'truncate transition-opacity duration-150 ease-out',
              foldersCollapsed && 'opacity-0',
            )}
          >
            {confirmingDisconnect ? '再点一次确认退出' : '退出登录'}
          </span>
        </button>
      </div>
    </aside>
  );
}
