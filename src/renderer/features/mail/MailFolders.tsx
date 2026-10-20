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
import { fadeIn } from '../../components/ui/motion';

const FOLDER_ICONS: Record<string, LucideIcon> = {
  '\\Inbox': Inbox,
  '\\Flagged': Star,
  '\\Sent': Send,
  '\\Junk': CircleAlert,
  '\\Archive': Archive,
};

/**
 * 与主进程 SPECIAL_USE_ORDER 语义对齐的排序档位；服务器 \Drafts/\Trash 由
 * 本地草稿与本地回收站取代（见 MailView 的过滤），档位 1/4 由两个伪条目占用。
 */
const FOLDER_RANKS: Record<string, number> = {
  '\\Inbox': 0,
  '\\Sent': 2,
  '\\Junk': 3,
  '\\Archive': 5,
};

export type MailSelection = { kind: 'folder'; id: number } | { kind: 'drafts' } | { kind: 'trash' };

type SidebarEntry =
  | { kind: 'folder'; folder: MailFolderInfo; rank: number }
  | { kind: 'drafts'; rank: number }
  | { kind: 'trash'; rank: number };

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
 * 行内文字用 grid 0fr↔1fr 过渡揭示；图标始终原位，高亮块随面板宽度连续缩放。
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

function SidebarRow({
  collapsed,
  selected,
  icon: Icon,
  label,
  count,
  countLabel,
  showDot = true,
  onSelect,
}: {
  collapsed: boolean;
  selected: boolean;
  icon: LucideIcon;
  label: string;
  count: number | null;
  countLabel: string;
  showDot?: boolean;
  onSelect: () => void;
}) {
  const hasCount = count !== null && count > 0;
  return (
    <CollapsedTip collapsed={collapsed} label={label}>
      <button
        aria-current={selected ? 'page' : undefined}
        aria-label={hasCount ? `${label}，${countLabel}` : label}
        className={cn(
          'relative flex h-8 shrink-0 items-center rounded-control px-2 text-left text-13 transition-colors duration-150',
          selected ? 'bg-hover-2 font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
        )}
        onClick={onSelect}
        type="button"
      >
        <Icon
          className={cn('size-4 shrink-0', selected ? 'text-ink' : 'text-ink-3')}
          strokeWidth={1.8}
        />
        <RowLabel collapsed={collapsed}>{label}</RowLabel>
        {!collapsed && hasCount && (
          <span className={cn(fadeIn, 'ml-2.5 shrink-0 text-xs tabular-nums text-ink-3')}>
            {count}
          </span>
        )}
        {collapsed && hasCount && showDot && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 size-1.5 rounded-full bg-ink"
          />
        )}
      </button>
    </CollapsedTip>
  );
}

type Props = {
  foldersCollapsed: boolean;
  setFoldersCollapsed: (update: (value: boolean) => boolean) => void;
  account: MailAccountInfo | null;
  folders: MailFolderInfo[];
  sync: MailSyncStatus | null;
  selection: MailSelection | null;
  onSelect: (selection: MailSelection) => void;
  draftCount: number;
  trashCount: number;
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
  selection,
  onSelect,
  draftCount,
  trashCount,
  confirmingDisconnect,
  handleDisconnect,
  composing,
  onCompose,
  hideHeader = false,
  className,
}: Props) {
  // 稳定排序:服务器文件夹已按档位+路径排好,同档保持原相对顺序;
  // 草稿箱/已删除常驻占位,避免同步后其他行跳动。
  const entries: SidebarEntry[] = [
    ...folders.map((folder) => ({
      kind: 'folder' as const,
      folder,
      rank: folder.specialUse ? (FOLDER_RANKS[folder.specialUse] ?? 90) : 90,
    })),
    { kind: 'drafts' as const, rank: 1 },
    { kind: 'trash' as const, rank: 4 },
  ].sort((a, b) => a.rank - b.rank);

  return (
    <aside
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-line',
        foldersCollapsed && 'items-stretch',
        className,
      )}
    >
      {!hideHeader && (
        <div className="flex h-11 shrink-0 items-center px-3">
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
        className={cn(
          'grid grid-cols-[minmax(0,1fr)] content-start gap-0.5 overflow-y-auto overflow-x-hidden p-2',
          foldersCollapsed && '[scrollbar-width:none]',
        )}
        id="mail-folders"
      >
        {folders.length === 0 && (
          <p
            className={cn(
              'whitespace-nowrap p-2 text-xs text-ink-3',
              'transition-opacity duration-150 ease-out',
              foldersCollapsed && 'opacity-0',
            )}
          >
            {sync?.phase === 'error' ? '同步失败，暂无文件夹' : '正在获取文件夹…'}
          </p>
        )}
        {entries.map((entry) => {
          if (entry.kind === 'folder') {
            const { folder } = entry;
            return (
              <SidebarRow
                collapsed={foldersCollapsed}
                count={folder.unread}
                countLabel={`${folder.unread} 封未读`}
                icon={FOLDER_ICONS[folder.specialUse ?? ''] ?? Folder}
                key={`folder-${folder.id}`}
                label={folder.name}
                onSelect={() => onSelect({ kind: 'folder', id: folder.id })}
                selected={selection?.kind === 'folder' && selection.id === folder.id}
                showDot={folder.specialUse !== '\\Junk'}
              />
            );
          }
          if (entry.kind === 'drafts') {
            return (
              <SidebarRow
                collapsed={foldersCollapsed}
                count={draftCount}
                countLabel={`${draftCount} 份草稿`}
                icon={FilePenLine}
                key="drafts"
                label="草稿箱"
                onSelect={() => onSelect({ kind: 'drafts' })}
                selected={selection?.kind === 'drafts'}
                showDot={false}
              />
            );
          }
          return (
            <SidebarRow
              collapsed={foldersCollapsed}
              count={trashCount}
              countLabel={`${trashCount} 封`}
              icon={Trash2}
              key="trash"
              label="已删除"
              onSelect={() => onSelect({ kind: 'trash' })}
              selected={selection?.kind === 'trash'}
              showDot={false}
            />
          );
        })}
      </nav>
      <div className="mt-auto grid grid-cols-[minmax(0,1fr)] content-start gap-0.5 p-2">
        <CollapsedTip collapsed={foldersCollapsed} label="发送邮件">
          <button
            aria-current={composing ? 'page' : undefined}
            aria-label="发送邮件"
            className={cn(
              'flex h-8 shrink-0 items-center rounded-control px-2 text-left text-13 transition-colors duration-150',
              composing
                ? 'bg-hover-2 font-medium text-ink'
                : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}
            onClick={onCompose}
            type="button"
          >
            <Pencil
              className={cn('size-4 shrink-0', composing ? 'text-ink' : 'text-ink-3')}
              strokeWidth={1.8}
            />
            <RowLabel collapsed={foldersCollapsed}>发送邮件</RowLabel>
          </button>
        </CollapsedTip>
        <div aria-hidden="true" className="my-2 border-t border-line" />
        <CollapsedTip collapsed={foldersCollapsed} label={account?.address ?? '未配置'}>
          <div
            className="flex h-11 min-w-0 items-center rounded-card px-2 text-ink-3"
            title={!foldersCollapsed ? (account?.address ?? '未配置') : undefined}
          >
            <UserRound className="size-4 shrink-0" strokeWidth={1.8} />
            <RowLabel collapsed={foldersCollapsed}>
              <span className="text-13 text-ink">
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
              'flex h-8 shrink-0 items-center rounded-control px-2 text-left text-13 transition-colors duration-150',
              confirmingDisconnect
                ? 'bg-hover-2 font-medium text-red'
                : 'text-ink-2 hover:bg-hover hover:text-red',
            )}
            onClick={() => void handleDisconnect()}
            data-mail-disconnect
            type="button"
          >
            <LogOut
              className={cn('size-4 shrink-0', confirmingDisconnect ? '' : 'text-ink-3')}
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
