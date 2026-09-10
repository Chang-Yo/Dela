import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import clsx from 'clsx';
import {
  Archive,
  CircleAlert,
  FilePenLine,
  Folder,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import type {
  MailAttachmentInfo,
  MailFolderInfo,
  MailMessageDetail,
  MailMessageSummary,
  MailState,
} from '../../../shared/api';
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

const MESSAGE_LIMIT = 200;

function formatMailDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function formatFullDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日（星期${weekdays[date.getDay()]}）${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatSize(size: number | null): string {
  if (size === null) return '';
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function formatMailAddress(name: string | null, address: string | null): string {
  if (name && address) return `${name} <${address}>`;
  return name ?? address ?? '';
}

function wrapHtmlBody(html: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>body{margin:0;padding:16px 20px;font-family:Inter,"Segoe UI","Microsoft YaHei UI",sans-serif;',
    'font-size:14px;line-height:1.65;color:#1c1c17;background:#fff;word-break:break-word}',
    'img{max-width:100%}a{color:#716328}table{max-width:100%}</style></head><body>',
    html,
    '</body></html>',
  ].join('');
}

function senderLabel(message: MailMessageSummary): string {
  if (!message.sender) return '(未知发件人)';
  return message.sender.name || message.sender.address || '(未知发件人)';
}

type ConfigureFormProps = {
  onSubmit: (address: string, password: string) => Promise<void>;
  error: string | null;
  busy: boolean;
};

function ConfigureForm({ onSubmit, error, busy }: ConfigureFormProps) {
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className={styles.configWrap}>
      <form
        className={styles.configCard}
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(address, password);
        }}
      >
        <p className="eyebrow">内置邮箱</p>
        <h2>连接交大邮箱</h2>
        <p className={styles.configCopy}>
          使用 jAccount 账号对应的邮箱和密码登录。凭据加密保存在本机，不会发送到其他服务。
        </p>
        <label className={styles.fieldLabel}>
          邮箱地址
          <input
            autoComplete="off"
            className={styles.textInput}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="name@sjtu.edu.cn"
            required
            type="email"
            value={address}
          />
        </label>
        <label className={styles.fieldLabel}>
          密码
          <input
            autoComplete="current-password"
            className={styles.textInput}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="jAccount 密码"
            required
            type="password"
            value={password}
          />
        </label>
        {error && <p className={styles.configError}>{error}</p>}
        <Button disabled={busy} type="submit" variant="primary">
          {busy ? '正在验证…' : '连接并同步'}
        </Button>
        <p className={styles.configHint}>服务器 mail.sjtu.edu.cn · IMAPS 993</p>
      </form>
    </div>
  );
}

type MailViewProps = Record<string, never>;

function MailUnavailable() {
  return (
    <div className={styles.mailPage}>
      <div className={styles.browserPreview}>
        <p className="eyebrow">浏览器预览</p>
        <h2>邮箱仅在 Dela 桌面端可用</h2>
        <p>邮件账户、凭据与本地缓存不会暴露给浏览器。请通过 Electron 窗口测试同步和阅读。</p>
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
  const [foldersCollapsed, setFoldersCollapsed] = useState(true);
  const [listWidth, setListWidth] = useState(320);

  const selectedFolderIdRef = useRef<number | null>(null);
  const autoSyncedRef = useRef(false);
  const desktopMediaRef = useRef<MediaQueryList | null>(null);
  const listResizeStart = useRef<{ x: number; width: number } | null>(null);

  const resizeList = (event: PointerEvent<HTMLDivElement>) => {
    const start = listResizeStart.current;
    if (!start) return;
    setListWidth(Math.min(480, Math.max(260, start.width + event.clientX - start.x)));
  };

  const refreshFolders = useCallback(async () => {
    setFolders([...(await dela.mail.listFolders())]);
  }, []);

  const loadMessages = useCallback(async (folderId: number) => {
    selectedFolderIdRef.current = folderId;
    setListLoading(true);
    try {
      setMessages([...(await dela.mail.listMessages(folderId, MESSAGE_LIMIT))]);
    } finally {
      setListLoading(false);
    }
  }, []);

  const openMessage = useCallback(async (messageId: number) => {
    setSelectedMessageId(messageId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const loaded = await dela.mail.getMessage(messageId);
      setDetail(loaded);
      if (!loaded.seen) {
        const result = await dela.mail.markSeen(messageId);
        if (result.ok) {
          setMessages((prev) =>
            prev.map((item) => (item.id === messageId ? { ...item, seen: true } : item)),
          );
        } else {
          setDetailError(result.error);
        }
      }
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
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

  const unreadInFolder = (folder: MailFolderInfo | null): number => folder?.unread ?? 0;

  if (state !== null && !account) {
    return (
      <div className={styles.mailPage}>
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

  return (
    <div className={styles.mailPage}>
      <PageHeader
        actions={
          <>
            <span
              className={clsx(
                styles.syncState,
                sync?.phase === 'error' && styles.syncError,
                (sync?.phase === 'syncing' || sync?.phase === 'connecting') && styles.syncActive,
              )}
            >
              {syncLabel}
            </span>
            <Button
              disabled={sync?.phase === 'syncing' || sync?.phase === 'connecting'}
              onClick={() => void dela.mail.syncNow().catch(() => {})}
              variant="primary"
            >
              ↻ 同步
            </Button>
          </>
        }
        eyebrow="内置邮箱"
        title="邮箱"
      />
      {sync?.phase === 'error' && sync.error && (
        <p className={styles.syncBanner}>同步出现问题：{sync.error}</p>
      )}
      <div
        className={clsx(styles.mailLayout, mobileReading && styles.mobileReadingPane)}
        style={
          {
            '--folder-width': foldersCollapsed ? '48px' : '220px',
            '--list-width': `${listWidth}px`,
          } as CSSProperties
        }
      >
        <aside className={clsx(styles.folderPane, foldersCollapsed && styles.isCollapsed)}>
          <button
            aria-label={foldersCollapsed ? '展开邮件文件夹' : '收起邮件文件夹'}
            className={styles.folderToggle}
            onClick={() => setFoldersCollapsed((collapsed) => !collapsed)}
            title={foldersCollapsed ? '展开邮件文件夹' : '收起邮件文件夹'}
            type="button"
          >
            {foldersCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          {!foldersCollapsed && (
            <>
              <div className={styles.accountCard}>
                <span aria-hidden="true" className={styles.accountMark}>
                  {(account?.address ?? 'D').charAt(0).toUpperCase()}
                </span>
                <div className={styles.accountInfo}>
                  <strong>{account?.address ?? '未配置'}</strong>
                  <small>{unreadInFolder(selectedFolder)} 封未读（当前文件夹）</small>
                </div>
              </div>
              <nav aria-label="邮件文件夹" className={styles.folderList}>
                {folders.length === 0 && (
                  <p className={styles.folderEmpty}>
                    {sync?.phase === 'error' ? '同步失败，暂无文件夹' : '正在获取文件夹…'}
                  </p>
                )}
                {folders.map((folder) => {
                  const Icon = FOLDER_ICONS[folder.specialUse ?? ''] ?? Folder;
                  return (
                    <button
                      className={clsx(
                        styles.folderItem,
                        folder.id === selectedFolderId && styles.isSelected,
                      )}
                      key={folder.id}
                      onClick={() => {
                        setSelectedFolderId(folder.id);
                        setMessages([]);
                        setSelectedMessageId(null);
                        setDetail(null);
                        setMobileReading(false);
                        void loadMessages(folder.id);
                      }}
                      type="button"
                    >
                      <span aria-hidden="true" className={styles.folderIcon}>
                        <Icon size={16} strokeWidth={1.7} />
                      </span>
                      <span className={styles.folderName}>{folder.name}</span>
                      {folder.unread !== null && folder.unread > 0 && (
                        <span className={styles.unreadBadge}>{folder.unread}</span>
                      )}
                    </button>
                  );
                })}
              </nav>
              <div className={styles.folderFooter}>
                <button
                  className={styles.disconnectButton}
                  onClick={() => void handleDisconnect()}
                  type="button"
                >
                  {confirmingDisconnect ? '再点一次确认退出' : '退出登录'}
                </button>
              </div>
            </>
          )}
        </aside>

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
                onClick={() => {
                  if (desktopMediaRef.current?.matches) {
                    void openMessage(message.id);
                  } else {
                    setMobileReading(true);
                    void openMessage(message.id);
                  }
                }}
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
        <div
          aria-label="调整邮件列表宽度"
          className={styles.listResizeHandle}
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
        />

        <section className={styles.readingPane}>
          <button
            className={styles.backButton}
            onClick={() => setMobileReading(false)}
            type="button"
          >
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
                <iframe
                  className={styles.htmlBody}
                  referrerPolicy="no-referrer"
                  sandbox=""
                  srcDoc={wrapHtmlBody(detail.bodyHtml)}
                  title="邮件正文"
                />
              ) : (
                <div className={styles.plainBody}>{detail.bodyText ?? '(无正文)'}</div>
              )}
            </article>
          )}
        </section>
      </div>
    </div>
  );
}
