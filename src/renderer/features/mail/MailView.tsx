import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type {
  MailFolderInfo,
  MailMessageDetail,
  MailMessageSummary,
  MailState,
} from '../../../shared/api';
import { ConfigureForm } from './MailConfigureForm';
import { MailFolders } from './MailFolders';
import { MailMessageList } from './MailMessageList';
import { MailReader } from './MailReader';
import { MailComposer } from './MailComposer';
import { formatMailDate, senderLabel } from './mail-format';
import { Resizer } from '../../components/ui/resizer';
import { cn } from '../../lib/utils';

const MESSAGE_LIMIT = 200;
const ignoreComposeDirty = () => {};

type MailViewProps = {
  onComposeDirtyChange?: (dirty: boolean) => void;
  /** 窄屏邮箱级抽屉是否展开,受控于 App 的 mobileDrawer。 */
  mobileDrawerOpen?: boolean;
  onMobileDrawerClose?: () => void;
};

function MailUnavailable() {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="grid w-full max-w-[460px] gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">浏览器预览</p>
        <h2 className="text-lg font-semibold tracking-tight">邮箱仅在 Dela 桌面端可用</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          邮件账户、凭据与本地缓存不会暴露给浏览器。请通过 Electron 窗口测试同步和阅读。
        </p>
      </div>
    </div>
  );
}

export function MailView({
  onComposeDirtyChange,
  mobileDrawerOpen = false,
  onMobileDrawerClose,
}: MailViewProps = {}) {
  if (!window.dela) return <MailUnavailable />;
  return (
    <DesktopMailView
      mobileDrawerOpen={mobileDrawerOpen}
      onMobileDrawerClose={onMobileDrawerClose}
      onComposeDirtyChange={onComposeDirtyChange}
    />
  );
}

function DesktopMailView({
  onComposeDirtyChange = ignoreComposeDirty,
  mobileDrawerOpen = false,
  onMobileDrawerClose,
}: MailViewProps) {
  const dela = window.dela!;
  const [state, setState] = useState<MailState | null>(null);
  const [folders, setFolders] = useState<MailFolderInfo[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [configureError, setConfigureError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [mobileReading, setMobileReading] = useState(false);
  const [foldersCollapsed, setFoldersCollapsed] = useState(() => {
    try {
      return localStorage.getItem('dela.mail.folders-collapsed') !== 'false';
    } catch {
      return true;
    }
  });
  const [listWidth, setListWidth] = useState(320);
  const [listResizing, setListResizing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [composeDirty, setComposeDirty] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [drawerSlot, setDrawerSlot] = useState<HTMLElement | null>(null);

  const selectedFolderIdRef = useRef<number | null>(null);
  const autoSyncedRef = useRef(false);
  const detailRequest = useRef(0);
  const listRequest = useRef(0);

  const updateComposeDirty = useCallback(
    (dirty: boolean) => {
      setComposeDirty(dirty);
      onComposeDirtyChange(dirty);
    },
    [onComposeDirtyChange],
  );

  const closeComposer = useCallback(() => {
    if (composeDirty && !window.confirm('这封邮件不会保存。确定抛弃吗？')) return false;
    updateComposeDirty(false);
    setComposing(false);
    return true;
  }, [composeDirty, updateComposeDirty]);

  useEffect(() => {
    try {
      localStorage.setItem('dela.mail.folders-collapsed', String(foldersCollapsed));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [foldersCollapsed]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // 抽屉挂载点由 AppShell 的 aside 常驻渲染,挂载后定位一次即可。
  useEffect(() => {
    setDrawerSlot(document.getElementById('mail-drawer-slot'));
  }, []);

  const refreshFolders = useCallback(async () => {
    setFolders([...(await dela.mail.listFolders())]);
  }, []);

  const loadMessages = useCallback(async (folderId: number) => {
    const request = ++listRequest.current;
    selectedFolderIdRef.current = folderId;
    setListLoading(true);
    try {
      const loaded = await dela.mail.listMessages(folderId, MESSAGE_LIMIT);
      if (request === listRequest.current) setMessages([...loaded]);
    } finally {
      if (request === listRequest.current) setListLoading(false);
    }
  }, []);

  const selectFolder = useCallback(
    (id: number) => {
      if (composing && !closeComposer()) return;
      detailRequest.current += 1;
      setDetailLoading(false);
      setDetailError(null);
      setSelectedFolderId(id);
      setMessages([]);
      setSelectedMessageId(null);
      setDetail(null);
      setMobileReading(false);
      void loadMessages(id);
    },
    [closeComposer, composing, loadMessages],
  );

  const handleCompose = useCallback(() => {
    setSendNotice(null);
    setComposing((current) => (current && composeDirty ? true : !current));
  }, [composeDirty]);

  const openMessage = useCallback(async (messageId: number) => {
    const request = ++detailRequest.current;
    setSelectedMessageId(messageId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const loaded = await dela.mail.getMessage(messageId);
      if (request !== detailRequest.current) return;
      setDetail(loaded);
      if (!loaded.seen) {
        const folderId = selectedFolderIdRef.current;
        const result = await dela.mail.markSeen(messageId);
        if (result.ok) {
          if (selectedFolderIdRef.current === folderId) {
            setMessages((prev) =>
              prev.map((item) => (item.id === messageId ? { ...item, seen: true } : item)),
            );
          }
          if (folderId !== null) {
            setFolders((prev) =>
              prev.map((folder) =>
                folder.id === folderId && folder.unread !== null
                  ? { ...folder, unread: Math.max(0, folder.unread - 1) }
                  : folder,
              ),
            );
          }
          if (request === detailRequest.current) {
            setDetail((current) =>
              current?.id === messageId ? { ...current, seen: true } : current,
            );
          }
        } else if (request === detailRequest.current) {
          setDetailError(result.error);
        }
      }
    } catch (error) {
      if (request === detailRequest.current)
        setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshFolders();
    const folderId = selectedFolderIdRef.current;
    if (folderId !== null) await loadMessages(folderId);
  }, [loadMessages, refreshFolders]);

  useEffect(() => {
    let active = true;
    void dela.mail.getState().then(async (initial) => {
      if (!active) return;
      setState(initial);
      if (!initial.account) return;
      const folderList = [...(await dela.mail.listFolders())];
      if (!active) return;
      setFolders(folderList);
      const inbox =
        folderList.find((folder) => folder.specialUse === '\\Inbox') ?? folderList[0] ?? null;
      if (inbox) {
        setSelectedFolderId(inbox.id);
        await loadMessages(inbox.id);
      }
      if (!autoSyncedRef.current) {
        autoSyncedRef.current = true;
        void dela.mail.syncNow().catch(() => {
          // 同步错误通过 mail:sync-status 事件展示。
        });
      }
    });
    const unsubscribe = dela.mail.onSyncStatus((status) => {
      setState((prev) => (prev ? { ...prev, sync: status } : prev));
      if (status.phase === 'idle' && status.finishedAt) void refreshAll();
    });
    return () => {
      active = false;
      detailRequest.current += 1;
      listRequest.current += 1;
      unsubscribe();
    };
    // 仅在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfigure = useCallback(async (address: string, password: string) => {
    setConfiguring(true);
    setConfigureError(null);
    try {
      const result = await dela.mail.configure({ address, password });
      if (!result.ok) {
        setConfigureError(result.error);
        return;
      }
      const next = await dela.mail.getState();
      setState(next);
      autoSyncedRef.current = true;
      void dela.mail.syncNow().catch(() => {
        // 同步错误通过 mail:sync-status 事件展示。
      });
    } finally {
      setConfiguring(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirmingDisconnect) {
      setConfirmingDisconnect(true);
      return;
    }
    setConfirmingDisconnect(false);
    await dela.mail.disconnect();
    setFolders([]);
    setMessages([]);
    setDetail(null);
    setSelectedFolderId(null);
    setSelectedMessageId(null);
    setState(await dela.mail.getState());
  }, [confirmingDisconnect]);

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

  const account = state?.account ?? null;
  const sync = state?.sync ?? null;

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;

  const filteredMessages = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return messages;
    return messages.filter((message) =>
      [message.subject, senderLabel(message), message.snippet]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(keyword)),
    );
  }, [messages, search]);

  if (state !== null && !account) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ConfigureForm busy={configuring} error={configureError} onSubmit={handleConfigure} />
      </div>
    );
  }

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

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {sync?.phase === 'error' && sync.error && (
        <p
          className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          同步出现问题：{sync.error}
        </p>
      )}
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-[var(--folder-width)_minmax(320px,var(--list-width))_1px_minmax(0,1fr)] transition-[grid-template-columns] duration-150 ease-out max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]',
          listResizing && 'transition-none',
        )}
        style={
          {
            '--folder-width': foldersCollapsed ? '48px' : '220px',
            '--list-width': `${listWidth}px`,
          } as CSSProperties
        }
      >
        {!narrow && (
          <MailFolders
            confirmingDisconnect={confirmingDisconnect}
            folders={folders}
            foldersCollapsed={foldersCollapsed}
            handleDisconnect={handleDisconnect}
            composing={composing}
            onCompose={handleCompose}
            account={account}
            sync={sync}
            selectedFolderId={selectedFolderId}
            setFoldersCollapsed={setFoldersCollapsed}
            onSelect={selectFolder}
          />
        )}

        {composing ? (
          <MailComposer
            accountAddress={account?.address ?? ''}
            onClose={() => void closeComposer()}
            onDirtyChange={updateComposeDirty}
            onSent={(warning) => {
              updateComposeDirty(false);
              setComposing(false);
              setSendNotice(warning ?? '邮件已发送');
              void dela.mail.syncNow().catch(() => {});
              window.setTimeout(() => setSendNotice(null), 3000);
            }}
          />
        ) : (
          <>
            <MailMessageList
              className={cn(
                'max-md:col-span-full max-md:row-start-2',
                mobileReading && 'max-md:hidden',
              )}
              selectedFolder={selectedFolder}
              filteredMessages={filteredMessages}
              selectedMessageId={selectedMessageId}
              listLoading={listLoading}
              search={search}
              setSearch={setSearch}
              syncBusy={syncBusy}
              syncLabel={syncLabel}
              onSync={() => dela.mail.syncNow()}
              onSelect={(id) => {
                setMobileReading(narrow);
                void openMessage(id);
              }}
            />
            <Resizer
              className="max-md:hidden"
              label="调整邮件列表宽度"
              max={480}
              min={320}
              onChange={setListWidth}
              onResizingChange={setListResizing}
              value={listWidth}
            />

            <MailReader
              className={cn(
                'max-md:col-span-full max-md:row-start-2',
                !mobileReading && 'max-md:hidden',
              )}
              detail={detail}
              detailLoading={detailLoading}
              detailError={detailError}
              selectedMessageId={selectedMessageId}
              openMessage={openMessage}
              downloadAttachment={(messageId, part) =>
                dela.mail.downloadAttachment(messageId, part)
              }
              setMobileReading={setMobileReading}
            />
          </>
        )}
      </div>
      {mobileDrawerOpen &&
        drawerSlot &&
        createPortal(
          <MailFolders
            className="min-h-0 flex-1 border-r-0"
            confirmingDisconnect={confirmingDisconnect}
            folders={folders}
            foldersCollapsed={false}
            handleDisconnect={handleDisconnect}
            composing={composing}
            onCompose={() => {
              onMobileDrawerClose?.();
              handleCompose();
            }}
            hideHeader
            account={account}
            sync={sync}
            selectedFolderId={selectedFolderId}
            setFoldersCollapsed={setFoldersCollapsed}
            onSelect={(id) => {
              onMobileDrawerClose?.();
              selectFolder(id);
            }}
          />,
          drawerSlot,
        )}
      {sendNotice && (
        <p className="pointer-events-none absolute right-5 bottom-5 rounded-md bg-foreground px-3 py-2 text-xs text-background shadow-lg">
          {sendNotice}
        </p>
      )}
    </div>
  );
}
