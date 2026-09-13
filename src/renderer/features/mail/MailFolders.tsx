import type { ReactElement, ReactNode } from 'react';

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
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
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

/** 折叠态图标悬浮时在右侧显示名称提示;展开时原样渲染。 */
function CollapsedTip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: ReactElement;
}) {
  if (!collapsed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 行内文字双态:折叠时宽度收为 0 并淡出,展开时随宽度揭示(clip),
 * 图标始终原位,高亮块随面板宽度连续缩放。
 */
function RowLabel({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'grid min-w-0 flex-1 transition-[grid-template-columns,padding-left] duration-150 ease-out',
        collapsed ? 'grid-cols-[0fr]' : 'grid-cols-[1fr] pl-2.5',
      )}
    >
      <span
        className={cn(
          'truncate whitespace-nowrap transition-opacity duration-150 ease-out',
          collapsed && 'opacity-0',
        )}
      >
        {children}
      </span>
    </span>
  );
}

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
        // minmax(0,1fr): 行宽锁定为面板宽,不随文字 max-content 撑出面板外。
        className="grid grid-cols-[minmax(0,1fr)] content-start gap-0.5 overflow-y-auto overflow-x-hidden p-2"
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
            <CollapsedTip collapsed={foldersCollapsed} key={folder.id} label={folder.name}>
              <button
                aria-current={selected ? 'page' : undefined}
                aria-label={`${folder.name}${hasUnread ? `，${folder.unread} 封未读` : ''}`}
                className={cn(
                  'relative flex h-8 shrink-0 items-center rounded-lg px-2 text-left text-sm transition-colors',
                  selected
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground',
                )}
                onClick={() => onSelect(folder.id)}
                type="button"
              >
                <Icon
                  className={cn('size-4 shrink-0', selected ? '' : 'text-muted-foreground')}
                  strokeWidth={1.8}
                />
                <RowLabel collapsed={foldersCollapsed}>{folder.name}</RowLabel>
                {!foldersCollapsed && hasUnread && (
                  <span className="ml-2.5 shrink-0 animate-in fade-in duration-150 text-xs tabular-nums text-muted-foreground">
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
            </CollapsedTip>
          );
        })}
      </nav>
      <div className="mt-auto grid grid-cols-[minmax(0,1fr)] content-start gap-0.5 p-2">
        <CollapsedTip collapsed={foldersCollapsed} label="发送邮件">
          <button
            aria-current={composing ? 'page' : undefined}
            aria-label="发送邮件"
            className={cn(
              'flex h-8 shrink-0 items-center rounded-lg px-2 text-left text-sm transition-colors',
              composing
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground',
            )}
            onClick={onCompose}
            type="button"
          >
            <Pencil
              className={cn('size-4 shrink-0', composing ? '' : 'text-muted-foreground')}
              strokeWidth={1.8}
            />
            <RowLabel collapsed={foldersCollapsed}>发送邮件</RowLabel>
          </button>
        </CollapsedTip>
        <div aria-hidden="true" className="my-2 border-t border-border/70" />
        <CollapsedTip collapsed={foldersCollapsed} label={account?.address ?? '未配置'}>
          <div
            className="flex h-11 min-w-0 items-center rounded-lg px-2 text-muted-foreground"
            title={!foldersCollapsed ? (account?.address ?? '未配置') : undefined}
          >
            <UserRound className="size-4 shrink-0" strokeWidth={1.8} />
            <RowLabel collapsed={foldersCollapsed}>
              <span className="text-sm text-foreground">
                {account ? account.address.split('@')[0] : '未配置'}
              </span>
            </RowLabel>
          </div>
        </CollapsedTip>
        <CollapsedTip
          collapsed={foldersCollapsed}
          label={confirmingDisconnect ? '再点一次确认退出' : '退出登录'}
        >
          <button
            aria-label={confirmingDisconnect ? '再点一次确认退出' : '退出登录'}
            className={cn(
              'flex h-8 shrink-0 items-center rounded-lg px-2 text-left text-sm transition-colors',
              confirmingDisconnect
                ? 'bg-accent font-medium text-destructive'
                : 'text-foreground/75 hover:bg-accent/60 hover:text-destructive',
            )}
            onClick={() => void handleDisconnect()}
            data-mail-disconnect
            type="button"
          >
            <LogOut
              className={cn('size-4 shrink-0', confirmingDisconnect ? '' : 'text-muted-foreground')}
              strokeWidth={1.8}
            />
            <RowLabel collapsed={foldersCollapsed}>
              {confirmingDisconnect ? '再点一次确认退出' : '退出登录'}
            </RowLabel>
          </button>
        </CollapsedTip>
      </div>
    </aside>
  );
}
