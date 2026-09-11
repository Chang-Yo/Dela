import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
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
import { formatMailDate, senderLabel } from './mail-format';
import { cn } from '../../lib/utils';

const MESSAGE_LIMIT = 200;

type MailViewProps = Record<string, never>;

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

export function MailView(_: MailViewProps = {}) {
  if (!window.dela) return <MailUnavailable />;
  return <DesktopMailView />;
}

function DesktopMailView() {
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

  const selectedFolderIdRef = useRef<number | null>(null);
  const autoSyncedRef = useRef(false);
  const desktopMediaRef = useRef<MediaQueryList | null>(null);
  const listResizeStart = useRef<{ x: number; width: number } | null>(null);
  const detailRequest = useRef(0);
  const listRequest = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem('dela.mail.folders-collapsed', String(foldersCollapsed));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [foldersCollapsed]);

  const resizeList = (event: PointerEvent<HTMLDivElement>) => {
    const start = listResizeStart.current;
    if (!start) return;
    setListWidth(Math.min(480, Math.max(320, start.width + event.clientX - start.x)));
  };

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
        const result = await dela.mail.markSeen(messageId);
        if (request !== detailRequest.current) return;
        if (result.ok) {
          setMessages((prev) =>
            prev.map((item) => (item.id === messageId ? { ...item, seen: true } : item)),
          );
        } else {
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
    desktopMediaRef.current = window.matchMedia('(min-width: 768px)');
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
    <div className="flex h-full min-h-0 flex-col">
      {sync?.phase === 'error' && sync.error && (
        <p
          className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          同步出现问题：{sync.error}
        </p>
      )}
      <div
        className="grid min-h-0 flex-1 grid-cols-[var(--folder-width)_minmax(320px,var(--list-width))_6px_minmax(0,1fr)] transition-[grid-template-columns] duration-150 ease-out"
        style={
          {
            '--folder-width': foldersCollapsed ? '48px' : '220px',
            '--list-width': `${listWidth}px`,
          } as CSSProperties
        }
      >
        <MailFolders
          confirmingDisconnect={confirmingDisconnect}
          folders={folders}
          foldersCollapsed={foldersCollapsed}
          handleDisconnect={handleDisconnect}
          account={account}
          selectedFolder={selectedFolder}
          sync={sync}
          selectedFolderId={selectedFolderId}
          setFoldersCollapsed={setFoldersCollapsed}
          onSelect={(id) => {
            detailRequest.current += 1;
            setDetailLoading(false);
            setDetailError(null);
            setSelectedFolderId(id);
            setMessages([]);
            setSelectedMessageId(null);
            setDetail(null);
            setMobileReading(false);
            void loadMessages(id);
          }}
        />

        <MailMessageList
          className={cn(mobileReading && 'max-md:hidden')}
          selectedFolder={selectedFolder}
          filteredMessages={filteredMessages}
          selectedMessageId={selectedMessageId}
          listLoading={listLoading}
          search={search}
          setSearch={setSearch}
          syncBusy={syncBusy}
          syncLabel={syncLabel}
          onSync={() => void dela.mail.syncNow().catch(() => {})}
          onSelect={(id) => {
            setMobileReading(!desktopMediaRef.current?.matches);
            void openMessage(id);
          }}
        />
        <div
          aria-label="调整邮件列表宽度"
          aria-orientation="vertical"
          aria-valuemax={480}
          aria-valuemin={320}
          aria-valuenow={listWidth}
          className="group relative cursor-ew-resize touch-none focus-visible:outline-none max-md:hidden"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            setListWidth((width) =>
              Math.min(480, Math.max(320, width + (event.key === 'ArrowRight' ? 20 : -20))),
            );
          }}
          onPointerCancel={() => {
            listResizeStart.current = null;
          }}
          onPointerDown={(event) => {
            listResizeStart.current = { x: event.clientX, width: listWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={resizeList}
          onPointerUp={(event) => {
            listResizeStart.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          role="separator"
          tabIndex={0}
        >
          <span className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-foreground/30 group-focus-visible:bg-foreground/40" />
        </div>

        <MailReader
          className={cn(!mobileReading && 'max-md:hidden')}
          detail={detail}
          detailLoading={detailLoading}
          detailError={detailError}
          selectedMessageId={selectedMessageId}
          openMessage={openMessage}
          setMobileReading={setMobileReading}
        />
      </div>
    </div>
  );
}
