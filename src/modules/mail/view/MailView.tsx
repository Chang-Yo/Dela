import { leaveComposer } from './compose-close';
import type { PageDrawer } from '../../../app/module';
import type { PreparedEmail, MailConfigureInput } from '../contract';
import { FilePenLine, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  mailContract,
  type MailFolderInfo,
  type MailMessageDetail,
  type MailMessageSummary,
  type MailState,
  type MailTrashItem,
} from '../contract';
import { MailAccountForm } from './MailAccountForm';
import { MailFolders, type MailSelection } from './MailFolders';
import { MailMessageList } from './MailMessageList';
import { MailReader } from './MailReader';
import { MailComposer, type MailComposerHandle } from './MailComposer';
import { MailTrashList } from './MailTrashList';
import { formatMailDate, formatFullDate, senderLabel } from './mail-format';
import { Resizable } from '../../../ui/resizable';
import { Button } from '../../../ui/button';
import { PanelHeader } from '../../../ui/panel-header';
import { cn } from '../../../ui/lib/cn';
import { ConnectCard } from '../../../ui/connect-card';
import { useMediaQuery } from '../../../ui/hooks/use-media-query';
import { useMailPreferences } from './store';
import { draftsKey, mailBoxKey, mailClient, mailStateKey, useMailState } from './use-mail';
import { showToast } from '../../../ui/toast';
import { errorMessage, subscribe } from '../../../core/protocol/contract';
import { Alert } from '../../../ui/alert';
import { ErrorText } from '../../../ui/error-text';

const MESSAGE_LIMIT = 200;

// 分级降档阈值按 grid 容器实测宽度计算；自动折叠阈值随 listWidth 浮动，
// 固定常数会在列表被拖宽时漏判，把阅读区挤到不可读。
const STACKED_THRESHOLD = 760;
const FOLDERS_WIDTH = 220;
const READER_COMFORT_WIDTH = 459;
const NARROW_MEDIA_QUERY = '(max-width: 767px)';

/** 回复预填不是本地草稿：不带 savedLocally，避免触发既有草稿的覆盖保存/发送后删除。 */
function replyDraft(source: MailMessageDetail): PreparedEmail {
  const subject = source.subject ?? '';
  const body = source.bodyText ?? '';
  const attribution = `在 ${formatFullDate(source.date) || '未知时间'}，${senderLabel(source)} 写道：`;
  const quoted = body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return {
    id: `reply-${source.id}`,
    to: source.sender?.address ? [source.sender.address] : [],
    subject: /^\s*re:/i.test(subject) ? subject : `Re: ${subject}`,
    text: body ? `${attribution}\n${quoted}` : attribution,
    files: [],
  };
}

/** 服务器 \Drafts/\Trash 不再显示:侧栏这两个位置由本地草稿与本地回收站取代。 */
const visibleFolders = (list: readonly MailFolderInfo[]) =>
  list.filter((folder) => folder.specialUse !== '\\Drafts' && folder.specialUse !== '\\Trash');

type MailViewProps = {
  openRequest?: { messageId?: number };
  mobileDrawerOpen: boolean;
  onMobileDrawerClose?: () => void;
  drawerContainer?: HTMLElement;
};

function MailUnavailable() {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="grid w-full max-w-115 gap-2">
        <p className="text-xs font-medium text-ink-3">浏览器预览</p>
        <h2 className="text-lg font-semibold tracking-tight">邮箱仅在 Dela 桌面端可用</h2>
        <p className="text-sm leading-relaxed text-ink-3">
          邮件账户、凭据与本地缓存不会暴露给浏览器。请通过 Electron 窗口测试同步和阅读。
        </p>
      </div>
    </div>
  );
}

export function MailView({
  mobileDrawerOpen,
  onMobileDrawerClose,
  drawerContainer,
  openRequest,
}: MailViewProps) {
  if (!window.dela) return <MailUnavailable />;
  return (
    <DesktopMailView
      mobileDrawerOpen={mobileDrawerOpen}
      onMobileDrawerClose={onMobileDrawerClose}
      drawerContainer={drawerContainer}
      openRequest={openRequest}
    />
  );
}

export function MailPage({
  target,
  drawer,
}: {
  target: { messageId?: number };
  drawer: PageDrawer | null;
}) {
  return (
    <MailView
      drawerContainer={drawer?.container}
      mobileDrawerOpen={drawer !== null}
      onMobileDrawerClose={drawer?.close}
      openRequest={target}
    />
  );
}

const foldersKey = [...mailBoxKey, 'folders'];
const trashKey = [...mailBoxKey, 'trash'];
const messagesPrefix = [...mailBoxKey, 'messages'];
const messagesKey = (folderId: number | null | undefined) => [...messagesPrefix, folderId];
const messageKey = (id: number | null, readonly: boolean) => [
  ...mailBoxKey,
  'message',
  id,
  readonly,
];

function toastFailure(title: string) {
  return (reason: unknown): never => {
    showToast({ variant: 'error', title, description: errorMessage(reason) });
    throw reason;
  };
}

function decrementUnread(client: QueryClient, folderId: number | undefined) {
  client.setQueryData<MailFolderInfo[]>(foldersKey, (folders) =>
    folders?.map((folder) =>
      folder.id === folderId && folder.unread !== null
        ? { ...folder, unread: Math.max(0, folder.unread - 1) }
        : folder,
    ),
  );
}

/** 读正文即标记已读，同 IMAP 取正文的语义；回收站的只读阅读不标记，恢复时保留原未读状态。 */
async function markSeen(client: QueryClient, message: MailMessageDetail) {
  try {
    const result = await mailClient.markSeen(message.id);
    if (!result.ok) {
      showToast({ variant: 'error', title: '标记已读失败', description: result.error });
      return;
    }
  } catch (reason) {
    showToast({ variant: 'error', title: '标记已读失败', description: errorMessage(reason) });
    return;
  }
  client.setQueryData<MailMessageSummary[]>(messagesKey(message.folderId), (messages) =>
    messages?.map((item) => (item.id === message.id ? { ...item, seen: true } : item)),
  );
  decrementUnread(client, message.folderId);
  client.setQueryData<MailMessageDetail>(
    messageKey(message.id, false),
    (current) => current && { ...current, seen: true },
  );
}

function refreshMailbox(client: QueryClient) {
  void client.invalidateQueries({ queryKey: foldersKey });
  void client.invalidateQueries({ queryKey: messagesPrefix });
  void client.invalidateQueries({ queryKey: trashKey });
}

function DesktopMailView({
  mobileDrawerOpen,
  onMobileDrawerClose,
  drawerContainer,
  openRequest,
}: MailViewProps) {
  const queryClient = useQueryClient();
  const state = useMailState();
  const account = state?.account ?? null;
  const accountAddress = account?.address ?? '';
  const [chosen, setChosen] = useState<MailSelection | null>(null);
  const [opened, setOpened] = useState<{ id: number; readonly: boolean } | null>(null);
  // 外部跳转（全局搜索、通知）要打开的邮件，用户在邮箱里另行导航即作废。
  const [request, setRequest] = useState(openRequest);
  const [pendingTarget, setPendingTarget] = useState(openRequest?.messageId ?? null);
  const [search, setSearch] = useState('');
  const [configureError, setConfigureError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [mobileReading, setMobileReading] = useState(false);
  const foldersCollapsed = useMailPreferences((state) => state.foldersCollapsed);
  const setFoldersCollapsed = (update: (value: boolean) => boolean) =>
    useMailPreferences.setState({ foldersCollapsed: update(foldersCollapsed) });
  const [listWidth, setListWidth] = useState(320);
  const [listResizing, setListResizing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<PreparedEmail | undefined>();
  const [openingDraft, setOpeningDraft] = useState(false);
  const composer = useRef<MailComposerHandle>(null);
  const narrow = useMediaQuery(NARROW_MEDIA_QUERY);
  const [contentWidth, setContentWidth] = useState(Number.POSITIVE_INFINITY);

  if (request !== openRequest) {
    setRequest(openRequest);
    // 跳转已过离开守卫（写信已保存或放弃），写信让位给目标邮件。
    if (openRequest?.messageId !== undefined) {
      setPendingTarget(openRequest.messageId);
      setSearch('');
      setComposing(false);
      setDraft(undefined);
    }
  }

  const foldersQuery = useQuery({
    queryKey: foldersKey,
    queryFn: () =>
      mailClient
        .folders()
        .then(visibleFolders)
        .catch(
          toastFailure(queryClient.getQueryData(foldersKey) ? '刷新文件夹失败' : '邮箱加载失败'),
        ),
    enabled: account !== null,
  });
  const folders = foldersQuery.data ?? [];
  // 跳转目标先只读一次，确认所在文件夹可见、且不在写信时，按普通阅读呈现。
  const targetQuery = useQuery({
    queryKey: messageKey(pendingTarget, true),
    queryFn: () => mailClient.message(pendingTarget!),
    enabled: pendingTarget !== null && folders.length > 0,
    gcTime: 0,
  });
  const targetFound = folders.some((folder) => folder.id === targetQuery.data?.folderId);
  const target = pendingTarget !== null && targetFound && !composing ? targetQuery.data : undefined;
  const targetFailure =
    pendingTarget === null
      ? null
      : targetQuery.error
        ? errorMessage(targetQuery.error)
        : targetQuery.data && !targetFound
          ? '目标邮件所在的文件夹不可用。'
          : null;

  const inbox = folders.find((folder) => folder.specialUse === '\\Inbox') ?? folders[0];
  const selection: MailSelection | null = target
    ? { kind: 'folder', id: target.folderId! }
    : (chosen ?? (inbox ? { kind: 'folder', id: inbox.id } : null));
  const reading = target ? { id: target.id, readonly: false } : opened;
  const showingReader = mobileReading || target !== undefined;
  const folderId = selection?.kind === 'folder' ? selection.id : null;

  const messagesQuery = useQuery({
    queryKey: messagesKey(folderId),
    queryFn: () =>
      mailClient
        .messages({ folderId: folderId!, limit: MESSAGE_LIMIT })
        .catch(toastFailure('加载邮件失败')),
    enabled: account !== null && folderId !== null,
    gcTime: 0,
  });
  const messages = messagesQuery.data ?? [];

  const detailQuery = useQuery({
    queryKey: messageKey(reading?.id ?? null, reading?.readonly ?? false),
    queryFn: async () => {
      const loaded = await mailClient.message(reading!.id);
      if (!loaded.seen && !reading!.readonly) void markSeen(queryClient, loaded);
      return loaded;
    },
    enabled: account !== null && reading !== null,
    gcTime: 0,
  });

  const draftsQuery = useQuery({
    queryKey: [...draftsKey, accountAddress],
    queryFn: () => mailClient.drafts(accountAddress),
    enabled: account !== null,
  });
  const localDrafts = draftsQuery.data ?? [];

  const trashQuery = useQuery({
    queryKey: trashKey,
    queryFn: () => mailClient.trash(),
    enabled: account !== null,
  });
  const trashItems = trashQuery.data ?? [];

  // 用户在邮箱里另行导航时，以当前呈现的跳转目标为起点。
  const settleTarget = () => {
    setPendingTarget(null);
    if (!target) return;
    setChosen(selection);
    setOpened(reading);
    setMobileReading(true);
  };

  const closeComposer = () => {
    const close = () => {
      setPendingTarget(null);
      setComposing(false);
      setDraft(undefined);
    };
    if (leaveComposer(close)) close();
  };
  const openDrafts = () => {
    if (!leaveComposer(openDrafts)) return;
    settleTarget();
    setComposing(false);
    setDraft(undefined);
    setChosen({ kind: 'drafts' });
    onMobileDrawerClose?.();
    void queryClient.invalidateQueries({ queryKey: draftsKey });
  };
  const openTrash = () => {
    if (!leaveComposer(openTrash)) return;
    settleTarget();
    setComposing(false);
    setDraft(undefined);
    setChosen({ kind: 'trash' });
    onMobileDrawerClose?.();
    void queryClient.invalidateQueries({ queryKey: trashKey });
  };
  const editDraft = async (id: string) => {
    if (openingDraft) return;
    setOpeningDraft(true);
    try {
      setDraft(await mailClient.openDraft(id));
      setComposing(true);
    } catch (reason) {
      showToast({ variant: 'error', title: '打开草稿失败', description: errorMessage(reason) });
    }
    setOpeningDraft(false);
  };

  // 容器宽度驱动分级降档;挂载时在提交阶段同步测量,避免按旧宽度先渲染再闪烁。
  const observeGrid = (element: HTMLDivElement) => {
    setContentWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setContentWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  };

  const selectFolder = (id: number) => {
    if (!leaveComposer(() => selectFolder(id))) return;
    setPendingTarget(null);
    setComposing(false);
    setDraft(undefined);
    setChosen({ kind: 'folder', id });
    setOpened(null);
    setMobileReading(false);
    void queryClient.resetQueries({ queryKey: messagesKey(id), exact: true });
  };

  const handleSelect = (next: MailSelection) => {
    if (next.kind === 'folder') selectFolder(next.id);
    else if (next.kind === 'drafts') openDrafts();
    else openTrash();
  };

  const handleCompose = () => {
    if (composing && composer.current?.dirty) return;
    settleTarget();
    setComposing(!composing);
  };

  const handleReply = (source: MailMessageDetail) => {
    const open = () => {
      settleTarget();
      setDraft(replyDraft(source));
      setComposing(true);
    };
    if (!leaveComposer(open)) return;
    open();
  };

  const openMessage = (id: number, readonly: boolean) => {
    settleTarget();
    setOpened({ id, readonly });
    setMobileReading(stacked);
    void queryClient.resetQueries({ queryKey: messageKey(id, readonly), exact: true });
  };

  useEffect(
    () =>
      subscribe(mailContract, window.dela?.bridge, 'syncStatus', (status) => {
        queryClient.setQueryData<MailState>(
          mailStateKey,
          (prev) => prev && { ...prev, sync: status },
        );
        if (status.phase === 'idle' && status.finishedAt) refreshMailbox(queryClient);
      }),
    [queryClient],
  );

  // 进入邮箱页或连上账号即后台同步一次，主进程合并重复请求；同步错误经 syncStatus 展示。
  useEffect(() => {
    if (accountAddress) void mailClient.sync().catch(() => {});
  }, [accountAddress]);

  const handleConfigure = async (input: MailConfigureInput) => {
    setConfiguring(true);
    setConfigureError(null);
    try {
      const result = await mailClient.configure(input);
      if (result.ok) queryClient.setQueryData(mailStateKey, await mailClient.state());
      else setConfigureError(result.error);
    } catch (reason) {
      setConfigureError(errorMessage(reason));
    }
    setConfiguring(false);
  };

  const handleDisconnect = async () => {
    if (!confirmingDisconnect) {
      setConfirmingDisconnect(true);
      return;
    }
    if (
      !leaveComposer(() => {
        void handleDisconnect();
      })
    )
      return;
    setConfirmingDisconnect(false);
    try {
      await mailClient.disconnect();
    } catch (reason) {
      showToast({ variant: 'error', title: '退出登录失败', description: errorMessage(reason) });
      return;
    }
    queryClient.setQueryData(mailStateKey, await mailClient.state());
    queryClient.removeQueries({ queryKey: mailBoxKey });
    setPendingTarget(null);
    setChosen(null);
    setOpened(null);
  };

  const handleDeleteMessage = async (message: MailMessageDetail) => {
    try {
      const result = await mailClient.deleteMessage(message.id);
      if (!result.ok) {
        showToast({ variant: 'error', title: '删除邮件失败', description: result.error });
        return;
      }
      settleTarget();
      setOpened(null);
      setMobileReading(false);
      queryClient.setQueryData<MailMessageSummary[]>(messagesKey(message.folderId), (prev) =>
        prev?.filter((item) => item.id !== message.id),
      );
      if (!message.seen) decrementUnread(queryClient, message.folderId);
      showToast({ variant: 'success', title: '已移入已删除' });
      void queryClient.invalidateQueries({ queryKey: trashKey });
    } catch (reason) {
      showToast({ variant: 'error', title: '删除邮件失败', description: errorMessage(reason) });
    }
  };

  const handleRestore = async (item: MailTrashItem) => {
    const folderName = item.folderName ?? '原文件夹';
    try {
      const result = await mailClient.restoreMessage(item.id);
      if (!result.ok) {
        showToast({ variant: 'error', title: '恢复邮件失败', description: result.error });
        return;
      }
      queryClient.setQueryData<MailTrashItem[]>(trashKey, (prev) =>
        prev?.filter((row) => row.id !== item.id),
      );
      showToast({ variant: 'success', title: `已恢复到 ${folderName}` });
      refreshMailbox(queryClient);
    } catch (reason) {
      showToast({ variant: 'error', title: '恢复邮件失败', description: errorMessage(reason) });
    }
  };

  const selectedMessageId = reading?.id ?? null;
  const clearReading = (messageId: number) => {
    if (selectedMessageId !== messageId) return;
    setOpened(null);
    setMobileReading(false);
  };

  const handlePurge = async (item: MailTrashItem) => {
    if (!window.confirm('彻底删除这封邮件？此操作不可恢复。')) return;
    try {
      const result = await mailClient.purgeMessage(item.id);
      if (!result.ok) {
        showToast({ variant: 'error', title: '彻底删除失败', description: result.error });
        return;
      }
      clearReading(item.id);
      queryClient.setQueryData<MailTrashItem[]>(trashKey, (prev) =>
        prev?.filter((row) => row.id !== item.id),
      );
    } catch (reason) {
      showToast({ variant: 'error', title: '彻底删除失败', description: errorMessage(reason) });
    }
  };

  const handleEmptyTrash = async () => {
    if (!window.confirm('清空全部已删除邮件？此操作不可恢复。')) return;
    try {
      const result = await mailClient.emptyTrash();
      if (!result.ok) {
        showToast({ variant: 'error', title: '清空回收站失败', description: result.error });
        return;
      }
      if (selectedMessageId !== null) clearReading(selectedMessageId);
      queryClient.setQueryData<MailTrashItem[]>(trashKey, []);
    } catch (reason) {
      showToast({ variant: 'error', title: '清空回收站失败', description: errorMessage(reason) });
    }
  };

  useEffect(() => {
    if (!confirmingDisconnect) return;
    const cancelDisconnect = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-mail-disconnect]')) {
        setConfirmingDisconnect(false);
      }
    };
    document.addEventListener('click', cancelDisconnect, true);
    return () => document.removeEventListener('click', cancelDisconnect, true);
  }, [confirmingDisconnect]);

  const sync = state?.sync ?? null;

  const selectedFolder =
    selection?.kind === 'folder'
      ? (folders.find((folder) => folder.id === selection.id) ?? null)
      : null;
  const readingTrash = selection?.kind === 'trash';

  const keyword = search.trim().toLowerCase();
  const filteredMessages = keyword
    ? messages.filter((message) =>
        [message.subject, senderLabel(message), message.snippet]
          .filter(Boolean)
          .some((field) => (field as string).toLowerCase().includes(keyword)),
      )
    : messages;

  const syncLabel = (() => {
    if (!sync) return '';
    if (sync.phase === 'connecting') return '正在连接…';
    if (sync.phase === 'syncing') {
      return sync.total !== null
        ? `正在同步 ${sync.folderPath ?? ''} ${sync.processed}/${sync.total}`
        : '正在同步…';
    }
    if (sync.phase === 'error') return '同步失败';
    if (account?.lastSyncedAt) return `上次同步 ${formatMailDate(account.lastSyncedAt)}`;
    return '尚未同步';
  })();

  const syncBusy = sync?.phase === 'syncing' || sync?.phase === 'connecting';

  const stacked = narrow || contentWidth < STACKED_THRESHOLD;
  // 非窄屏但容器偏窄时强制折叠文件夹栏，不改持久化偏好；阈值随当前列表宽度浮动。
  const autoCollapseFolders =
    !narrow && contentWidth < FOLDERS_WIDTH + listWidth + 1 + READER_COMFORT_WIDTH;
  const effectiveFoldersCollapsed = foldersCollapsed || autoCollapseFolders;
  const stackedPlacement = narrow ? 'col-span-full row-start-2' : 'col-start-2';

  const listLoading = messagesQuery.isFetching;
  const detail = detailQuery.data ?? null;
  const detailLoading = detailQuery.isFetching;
  const trashLoading = trashQuery.isFetching;
  const detailError = detailQuery.error ? errorMessage(detailQuery.error) : targetFailure;
  const draftError = draftsQuery.error ? errorMessage(draftsQuery.error) : null;
  const trashError = trashQuery.error ? errorMessage(trashQuery.error) : null;

  if (state !== undefined && !account) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 overflow-y-auto p-6">
          <ConnectCard
            className="m-auto"
            description="用邮箱地址与密码连接 IMAP/SMTP 服务器，凭据加密保存在本机。"
            title="连接邮箱"
          >
            <div className="w-full">
              <MailAccountForm
                error={configureError}
                onSubmit={(input) => void handleConfigure(input)}
                submit={
                  <Button disabled={configuring} type="submit">
                    {configuring ? '正在验证…' : '连接并同步'}
                  </Button>
                }
              />
            </div>
          </ConnectCard>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {sync?.phase === 'error' && sync.error && (
        <Alert className="mx-4 mt-3" role="alert">
          同步出现问题：{sync.error}
        </Alert>
      )}
      <div
        ref={observeGrid}
        className={cn(
          'grid min-h-0 flex-1 transition-[grid-template-columns] duration-base ease-out',
          narrow
            ? 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)]'
            : stacked
              ? 'grid-cols-[3rem_minmax(0,1fr)]'
              : 'grid-cols-[var(--folder-width)_minmax(320px,var(--list-width))_1px_minmax(0,1fr)]',
          listResizing && 'transition-none',
        )}
        style={
          {
            '--folder-width': effectiveFoldersCollapsed ? '48px' : '220px',
            '--list-width': `${listWidth}px`,
          } as CSSProperties
        }
      >
        {!narrow && (
          <MailFolders
            confirmingDisconnect={confirmingDisconnect}
            folders={folders}
            foldersCollapsed={effectiveFoldersCollapsed}
            handleDisconnect={handleDisconnect}
            composing={composing}
            selection={selection}
            onSelect={handleSelect}
            draftCount={localDrafts.length}
            trashCount={trashItems.length}
            onCompose={handleCompose}
            account={account}
            sync={sync}
            // 自动折叠期间隐藏开关,避免用户展开后又被强制折叠;宽度恢复后开关随用户偏好回归。
            hideHeader={autoCollapseFolders}
            setFoldersCollapsed={setFoldersCollapsed}
          />
        )}

        {composing ? (
          <MailComposer
            key={draft?.id ?? 'new'}
            className={stacked ? stackedPlacement : 'col-span-3'}
            draft={draft}
            accountAddress={accountAddress}
            onClose={() => void closeComposer()}
            ref={composer}
            onSent={(warning) => {
              setPendingTarget(null);
              setComposing(false);
              setDraft(undefined);
              showToast({ variant: 'success', title: '邮件已发送' });
              if (warning)
                showToast({
                  variant: 'error',
                  title: '本地草稿删除失败',
                  description: warning,
                });
              void mailClient.sync().catch(() => {});
            }}
          />
        ) : selection?.kind === 'drafts' ? (
          <section
            className={cn(
              'flex min-h-0 flex-col overflow-auto',
              stacked ? stackedPlacement : 'col-span-3',
            )}
            aria-label="本地草稿"
          >
            <PanelHeader size="lg">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <FilePenLine className="size-4" />
                本地草稿
              </h2>
              <small className="text-xs text-ink-3">{localDrafts.length} 份</small>
            </PanelHeader>
            <div className="min-h-0 flex-1 p-4">
              {draftError && <ErrorText size="sm">{draftError}</ErrorText>}
              {!localDrafts.length && <p className="text-sm text-ink-3">暂无草稿</p>}
              {localDrafts.map((item) => (
                <div key={item.id} className="flex items-center gap-2 border-b py-3">
                  <button
                    disabled={openingDraft}
                    className="min-w-0 flex-1 rounded text-left transition-colors hover:bg-hover-strong"
                    onClick={() => void editDraft(item.id)}
                  >
                    <strong className="block truncate text-sm">{item.subject || '(无主题)'}</strong>
                    <span className="block truncate text-xs text-ink-3">
                      {item.recipientText || '未填写收件人'} ·{' '}
                      {new Date(item.updatedAt).toLocaleString('zh-CN')}
                    </span>
                  </button>
                  <button
                    aria-label="删除草稿"
                    title="删除草稿"
                    className="rounded p-2 hover:bg-hover-strong"
                    onClick={() => {
                      if (!window.confirm('删除这份本地草稿？')) return;
                      void mailClient
                        .deleteDraft(item.id)
                        .then(() =>
                          queryClient.setQueryData<typeof localDrafts>(
                            [...draftsKey, accountAddress],
                            (items) => items?.filter((row) => row.id !== item.id),
                          ),
                        )
                        .catch((reason) =>
                          showToast({
                            variant: 'error',
                            title: '删除草稿失败',
                            description: errorMessage(reason),
                          }),
                        );
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <>
            {readingTrash ? (
              <MailTrashList
                className={cn(stacked && stackedPlacement, stacked && showingReader && 'hidden')}
                items={trashItems}
                loading={trashLoading}
                error={trashError}
                selectedMessageId={selectedMessageId}
                onOpen={(id) => openMessage(id, true)}
                onRestore={(item) => void handleRestore(item)}
                onPurge={(item) => void handlePurge(item)}
                onEmpty={() => void handleEmptyTrash()}
              />
            ) : (
              <MailMessageList
                className={cn(stacked && stackedPlacement, stacked && showingReader && 'hidden')}
                selectedFolder={selectedFolder}
                filteredMessages={filteredMessages}
                selectedMessageId={selectedMessageId}
                listLoading={listLoading}
                search={search}
                setSearch={setSearch}
                syncBusy={syncBusy}
                syncLabel={syncLabel}
                onSync={() => mailClient.sync()}
                onSelect={(id) => openMessage(id, false)}
              />
            )}
            <Resizable
              className={stacked ? 'hidden' : 'bg-line/60'}
              label="调整邮件列表宽度"
              max={480}
              min={320}
              onValueChange={setListWidth}
              onResizingChange={setListResizing}
              value={listWidth}
            />

            <MailReader
              className={cn(stacked && stackedPlacement, stacked && !showingReader && 'hidden')}
              detail={detail}
              detailLoading={detailLoading}
              detailError={detailError}
              accountAddress={accountAddress}
              selectedMessageId={selectedMessageId}
              openMessage={openMessage}
              downloadAttachment={(messageId, part) =>
                mailClient.downloadAttachment({ messageId, part })
              }
              onReply={handleReply}
              onDelete={(target) => void handleDeleteMessage(target)}
              readOnly={readingTrash}
              showBackButton={stacked}
              setMobileReading={(value) => {
                settleTarget();
                setMobileReading(value);
              }}
            />
          </>
        )}
      </div>
      {mobileDrawerOpen &&
        drawerContainer &&
        createPortal(
          <MailFolders
            className="min-h-0 flex-1 border-r-0"
            confirmingDisconnect={confirmingDisconnect}
            folders={folders}
            foldersCollapsed={false}
            handleDisconnect={handleDisconnect}
            composing={composing}
            selection={selection}
            onSelect={(next) => {
              onMobileDrawerClose?.();
              handleSelect(next);
            }}
            draftCount={localDrafts.length}
            trashCount={trashItems.length}
            onCompose={() => {
              onMobileDrawerClose?.();
              handleCompose();
            }}
            hideHeader
            account={account}
            sync={sync}
            setFoldersCollapsed={setFoldersCollapsed}
          />,
          drawerContainer,
        )}
    </div>
  );
}
