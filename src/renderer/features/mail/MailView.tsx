import { leaveComposer } from './compose-close';
import type { PreparedEmail, MailDraftSummary } from '../../../shared/api';
import { FilePenLine, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  MailFolderInfo,
  MailMessageDetail,
  MailMessageSummary,
  MailState,
  MailTrashItem,
} from '../../../shared/api';
import { ConfigureForm } from './MailConfigureForm';
import { MailFolders, type MailSelection } from './MailFolders';
import { MailMessageList } from './MailMessageList';
import { MailReader } from './MailReader';
import { MailComposer } from './MailComposer';
import { MailTrashList } from './MailTrashList';
import { formatMailDate, formatFullDate, senderLabel } from './mail-format';
import { Resizer } from '../../components/ui/resizer';
import { cn } from '../../lib/utils';

const MESSAGE_LIMIT = 200;

// 邮箱内容区分级降档阈值(单位 px,作用于 grid 容器实测宽度 W):
// - STACKED_THRESHOLD = 760:折叠态四列的可读下限 = 48(图标栏) + 320(列表最小宽) + 1(分隔线)
//   + 391(阅读区可读下限,在 380–400 间取整);W 再小则阅读区不可读,降为列表/详情二选一的单栏。
// - 自动折叠阈值按实际 listWidth 动态计算 = 220(展开侧栏) + listWidth + 1(分隔线)
//   + READER_COMFORT_WIDTH(阅读区舒适下限)。列表可被拖到 480,固定常数会在
//   1000–1160px 区间漏判,把阅读区挤到 300px 以下。
const STACKED_THRESHOLD = 760;
const FOLDERS_WIDTH = 220;
const READER_COMFORT_WIDTH = 459;
/** 窄屏媒体查询:窗口宽度决定走 AppShell 抽屉的单列布局。 */
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
  openRequest?: { messageId: number };
  /** 窄屏邮箱级抽屉是否展开,受控于 App 的 mobileDrawer。 */
  mobileDrawerOpen?: boolean;
  onMobileDrawerClose?: () => void;
};

function MailUnavailable() {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="grid w-full max-w-[460px] gap-2">
        <p className="text-[11px] font-medium text-ink-3">浏览器预览</p>
        <h2 className="text-lg font-semibold tracking-tight">邮箱仅在 Dela 桌面端可用</h2>
        <p className="text-[13px] leading-relaxed text-ink-3">
          邮件账户、凭据与本地缓存不会暴露给浏览器。请通过 Electron 窗口测试同步和阅读。
        </p>
      </div>
    </div>
  );
}

export function MailView({
  mobileDrawerOpen = false,
  onMobileDrawerClose,
  openRequest,
}: MailViewProps = {}) {
  if (!window.dela) return <MailUnavailable />;
  return (
    <DesktopMailView
      mobileDrawerOpen={mobileDrawerOpen}
      onMobileDrawerClose={onMobileDrawerClose}
      openRequest={openRequest}
    />
  );
}

function DesktopMailView({
  mobileDrawerOpen = false,
  onMobileDrawerClose,
  openRequest,
}: MailViewProps) {
  const dela = window.dela!;
  const [state, setState] = useState<MailState | null>(null);
  const [folders, setFolders] = useState<MailFolderInfo[]>([]);
  const [selection, setSelection] = useState<MailSelection | null>(null);
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
  const [draft, setDraft] = useState<PreparedEmail | undefined>();
  const [localDrafts, setLocalDrafts] = useState<MailDraftSummary[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [openingDraft, setOpeningDraft] = useState(false);
  const [composeDirty, setComposeDirty] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [trashItems, setTrashItems] = useState<MailTrashItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_MEDIA_QUERY).matches);
  const [drawerSlot, setDrawerSlot] = useState<HTMLElement | null>(null);
  // 邮箱 grid 容器实测宽度;初始按最宽处理,挂载后在布局阶段同步测量并纠正,不产生可见闪烁。
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null);
  const [contentWidth, setContentWidth] = useState(Number.POSITIVE_INFINITY);

  const selectedFolderIdRef = useRef<number | null>(null);
  const autoSyncedRef = useRef(false);
  const detailRequest = useRef(0);
  const listRequest = useRef(0);
  const trashRequest = useRef(0);
  const draftRequest = useRef(0);
  const noticeTimer = useRef<number | null>(null);
  const navigationRequest = useRef(0);
  const processedOpenRequest = useRef<{ messageId: number } | undefined>(undefined);

  /** 瞬时提示,样式沿用发送成功通知;新提示顶掉旧提示并接管其定时器。 */
  const notify = useCallback((text: string) => {
    setSendNotice(text);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null;
      setSendNotice(null);
    }, 3000);
  }, []);

  const loadDrafts = useCallback(async (account: string) => {
    const request = ++draftRequest.current;
    try {
      const loaded = await dela.mail.listDrafts(account);
      if (request === draftRequest.current) setLocalDrafts(loaded);
    } catch (reason) {
      if (request === draftRequest.current) setDraftError(String(reason));
    }
  }, []);

  const loadTrash = useCallback(async () => {
    const request = ++trashRequest.current;
    setTrashLoading(true);
    try {
      const loaded = await dela.mail.listTrash();
      if (request === trashRequest.current) {
        setTrashItems([...loaded]);
        setTrashError(null);
      }
    } catch (reason) {
      if (request === trashRequest.current) setTrashError(String(reason));
    } finally {
      if (request === trashRequest.current) setTrashLoading(false);
    }
  }, []);

  const accountAddress = state?.account?.address ?? '';

  const closeComposer = useCallback(() => {
    const close = () => {
      setComposeDirty(false);
      setComposing(false);
      setDraft(undefined);
      // 编辑器内可能保存过草稿,刷新侧栏草稿数。
      void loadDrafts(accountAddress);
    };
    if (!leaveComposer(close)) return false;
    close();
    return true;
  }, [accountAddress, loadDrafts]);
  const openDrafts = () => {
    if (!leaveComposer(openDrafts)) return;
    navigationRequest.current += 1;
    setComposing(false);
    setDraft(undefined);
    setSelection({ kind: 'drafts' });
    setDraftError(null);
    onMobileDrawerClose?.();
    void loadDrafts(accountAddress);
  };
  const openTrash = () => {
    if (!leaveComposer(openTrash)) return;
    navigationRequest.current += 1;
    setComposing(false);
    setDraft(undefined);
    setSelection({ kind: 'trash' });
    setTrashError(null);
    onMobileDrawerClose?.();
    void loadTrash();
  };
  const editDraft = async (id: string) => {
    if (openingDraft) return;
    setOpeningDraft(true);
    setDraftError(null);
    try {
      setDraft(await dela.mail.openDraft(id));
      setComposing(true);
    } catch (reason) {
      setDraftError(String(reason));
    } finally {
      setOpeningDraft(false);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem('dela.mail.folders-collapsed', String(foldersCollapsed));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [foldersCollapsed]);

  useEffect(() => {
    const media = window.matchMedia(NARROW_MEDIA_QUERY);
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // 容器宽度驱动分级降档;未配置账户时 grid 晚于首帧挂载,依赖 gridElement 触发本 effect 重跑。
  useLayoutEffect(() => {
    if (!gridElement) return;
    // 挂载即同步测量一次,避免按旧宽度先渲染再闪烁;后续变化交给 ResizeObserver。
    setContentWidth(gridElement.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setContentWidth(width);
    });
    observer.observe(gridElement);
    return () => observer.disconnect();
  }, [gridElement]);

  // 抽屉挂载点由 AppShell 的 aside 常驻渲染,挂载后定位一次即可。
  useEffect(() => {
    setDrawerSlot(document.getElementById('mail-drawer-slot'));
  }, []);

  const refreshFolders = useCallback(async () => {
    setFolders([...visibleFolders(await dela.mail.listFolders())]);
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
      if (!leaveComposer(() => selectFolder(id))) return;
      navigationRequest.current += 1;
      setComposing(false);
      setDraft(undefined);
      detailRequest.current += 1;
      setDetailLoading(false);
      setDetailError(null);
      setSelection({ kind: 'folder', id });
      setMessages([]);
      setSelectedMessageId(null);
      setDetail(null);
      setMobileReading(false);
      void loadMessages(id);
    },
    [loadMessages],
  );

  const handleSelect = (next: MailSelection) => {
    if (next.kind === 'folder') selectFolder(next.id);
    else if (next.kind === 'drafts') openDrafts();
    else openTrash();
  };

  const handleCompose = useCallback(() => {
    setSendNotice(null);
    setComposing((current) => (current && composeDirty ? true : !current));
  }, [composeDirty]);

  const handleReply = useCallback((source: MailMessageDetail) => {
    const open = () => {
      setSendNotice(null);
      setDraft(replyDraft(source));
      setComposing(true);
    };
    if (!leaveComposer(open)) return;
    open();
  }, []);

  const openMessage = useCallback(async (messageId: number, options?: { readonly?: boolean }) => {
    navigationRequest.current += 1;
    const request = ++detailRequest.current;
    setSelectedMessageId(messageId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const loaded = await dela.mail.getMessage(messageId);
      if (request !== detailRequest.current) return;
      setDetail(loaded);
      // 只读阅读(回收站)不标记已读:恢复时保留原未读状态。
      if (!loaded.seen && !options?.readonly) {
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
    // 同步结束/恢复邮件后回收站可能被自动清理或变化,刷新角标计数。
    void loadTrash();
  }, [loadMessages, loadTrash, refreshFolders]);

  useEffect(() => {
    let active = true;
    // 捕获导航计数:草稿/回收站按钮在 folders 到达前即可点击,加载完成后不得覆盖用户选择。
    const nav = navigationRequest.current;
    void dela.mail.getState().then(async (initial) => {
      if (!active) return;
      setState(initial);
      if (!initial.account) return;
      const folderList = [...visibleFolders(await dela.mail.listFolders())];
      if (!active) return;
      setFolders(folderList);
      const inbox =
        folderList.find((folder) => folder.specialUse === '\\Inbox') ?? folderList[0] ?? null;
      // 加载期间用户已切换草稿/回收站等视图时不再强制回到收件箱;后续草稿/回收站/自动同步仍需执行。
      if (inbox && navigationRequest.current === nav) {
        setSelection({ kind: 'folder', id: inbox.id });
        await loadMessages(inbox.id);
      }
      void loadDrafts(initial.account.address);
      void loadTrash();
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
      navigationRequest.current += 1;
      detailRequest.current += 1;
      listRequest.current += 1;
      trashRequest.current += 1;
      draftRequest.current += 1;
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
    if (
      !leaveComposer(() => {
        void handleDisconnect();
      })
    )
      return;
    setConfirmingDisconnect(false);
    await dela.mail.disconnect();
    setFolders([]);
    setMessages([]);
    setDetail(null);
    setSelection(null);
    setSelectedMessageId(null);
    setLocalDrafts([]);
    setDraftError(null);
    setTrashItems([]);
    setTrashError(null);
    setState(await dela.mail.getState());
  }, [confirmingDisconnect]);

  // 阅读页删除:纯本地移入回收站,可恢复,无需确认。
  const handleDeleteMessage = async (target: MailMessageDetail) => {
    try {
      const result = await dela.mail.deleteMessage(target.id);
      if (!result.ok) {
        setDetailError(result.error);
        return;
      }
      const folderId = selectedFolderIdRef.current;
      detailRequest.current += 1;
      setSelectedMessageId(null);
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      setMobileReading(false);
      setMessages((prev) => prev.filter((message) => message.id !== target.id));
      if (!target.seen && folderId !== null) {
        setFolders((prev) =>
          prev.map((folder) =>
            folder.id === folderId && folder.unread !== null
              ? { ...folder, unread: Math.max(0, folder.unread - 1) }
              : folder,
          ),
        );
      }
      notify('已移入已删除');
      void loadTrash();
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleRestore = async (item: MailTrashItem) => {
    try {
      const result = await dela.mail.restoreMessage(item.id);
      if (!result.ok) {
        setTrashError(result.error);
        return;
      }
      setTrashItems((prev) => prev.filter((row) => row.id !== item.id));
      notify(`已恢复到 ${item.folderName ?? '原文件夹'}`);
      // 原文件夹列表与未读数可能变化。
      void refreshAll();
    } catch (reason) {
      setTrashError(String(reason));
    }
  };

  /** 彻底删除/清空后,若该邮件正被阅读则回到列表态。 */
  const clearReading = (messageId: number) => {
    if (selectedMessageId !== messageId) return;
    detailRequest.current += 1;
    setSelectedMessageId(null);
    setDetail(null);
    setDetailLoading(false);
    setDetailError(null);
    setMobileReading(false);
  };

  const handlePurge = async (item: MailTrashItem) => {
    if (!window.confirm('彻底删除这封邮件？此操作不可恢复。')) return;
    try {
      const result = await dela.mail.purgeMessage(item.id);
      if (!result.ok) {
        setTrashError(result.error);
        return;
      }
      clearReading(item.id);
      setTrashItems((prev) => prev.filter((row) => row.id !== item.id));
    } catch (reason) {
      setTrashError(String(reason));
    }
  };

  const handleEmptyTrash = async () => {
    if (!window.confirm('清空全部已删除邮件？此操作不可恢复。')) return;
    try {
      const result = await dela.mail.emptyTrash();
      if (!result.ok) {
        setTrashError(result.error);
        return;
      }
      if (selectedMessageId !== null) clearReading(selectedMessageId);
      setTrashItems([]);
    } catch (reason) {
      setTrashError(String(reason));
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

  const account = state?.account ?? null;
  const sync = state?.sync ?? null;

  const selectedFolder =
    selection?.kind === 'folder'
      ? (folders.find((folder) => folder.id === selection.id) ?? null)
      : null;
  const readingTrash = selection?.kind === 'trash';

  const filteredMessages = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return messages;
    return messages.filter((message) =>
      [message.subject, senderLabel(message), message.snippet]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(keyword)),
    );
  }, [messages, search]);

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

  // 单栏态(第二级降档):窗口本身窄屏,或容器实测宽度不足。
  const stacked = narrow || contentWidth < STACKED_THRESHOLD;
  // 第一级降档:非窄屏但容器偏窄时强制折叠文件夹栏;持久化偏好不动,宽度恢复后还原用户偏好。
  // 阈值随当前列表宽度浮动:用户拖宽列表时同步收紧判定,避免阅读区被两头挤压。
  const autoCollapseFolders =
    !narrow && contentWidth < FOLDERS_WIDTH + listWidth + 1 + READER_COMFORT_WIDTH;
  const effectiveFoldersCollapsed = foldersCollapsed || autoCollapseFolders;
  // 单栏态下内容面板的网格占位:narrow 沿用第二行整行,非 narrow 单栏落到图标栏右侧一列。
  const stackedPlacement = narrow ? 'col-span-full row-start-2' : 'col-start-2';

  // 全局搜索已经由 App 通过既有草稿守卫放行；这里仅切换到目标邮件，避免重新挂载邮箱而丢失其他状态。
  useEffect(() => {
    if (!openRequest || !account || !folders.length) return;
    if (processedOpenRequest.current === openRequest) return;
    processedOpenRequest.current = openRequest;
    const request = ++navigationRequest.current;
    void dela.mail
      .getMessage(openRequest.messageId)
      .then((message) => {
        if (request !== navigationRequest.current) return;
        const folderId = message.folderId;
        if (!folderId || !folders.some((folder) => folder.id === folderId)) {
          setDetailError('目标邮件所在的文件夹不可用。');
          return;
        }
        // App 侧守卫只覆盖点击瞬间;folders 迟到时这里仍可能撞上脏编辑器,复用 leaveComposer
        // 走保存/放弃确认后再切换,不允许静默丢内容。
        const apply = () => {
          if (request !== navigationRequest.current) return;
          setComposeDirty(false);
          setComposing(false);
          setDraft(undefined);
          setSearch('');
          selectedFolderIdRef.current = folderId;
          setSelection({ kind: 'folder', id: folderId });
          setMessages([]);
          setSelectedMessageId(null);
          setDetail(null);
          setDetailError(null);
          setMobileReading(stacked);
          void loadMessages(folderId);
          void openMessage(message.id);
          // 确认对话框可能刚保存过草稿,刷新侧栏草稿数。
          void loadDrafts(account.address);
        };
        if (!leaveComposer(apply)) return;
        apply();
      })
      .catch((reason) => {
        if (request === navigationRequest.current)
          setDetailError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [account, dela.mail, folders, loadMessages, openMessage, openRequest, stacked]);

  if (state !== null && !account) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ConfigureForm busy={configuring} error={configureError} onSubmit={handleConfigure} />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {sync?.phase === 'error' && sync.error && (
        <p
          className="mx-4 mt-3 rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-[12px] text-red"
          role="alert"
        >
          同步出现问题：{sync.error}
        </p>
      )}
      <div
        ref={setGridElement}
        className={cn(
          'grid min-h-0 flex-1 transition-[grid-template-columns] duration-150 ease-out',
          // narrow 维持单列 + AppShell 抽屉;非 narrow 单栏保留 48px 图标栏;宽布局维持可拖四列。
          narrow
            ? 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)]'
            : stacked
              ? 'grid-cols-[48px_minmax(0,1fr)]'
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
            accountAddress={account?.address ?? ''}
            onClose={() => void closeComposer()}
            onDirtyChange={setComposeDirty}
            onSent={(warning) => {
              setComposeDirty(false);
              setComposing(false);
              setDraft(undefined);
              notify(warning ?? '邮件已发送');
              void dela.mail.syncNow().catch(() => {});
              void loadDrafts(account?.address ?? '');
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
            {/* 与文件夹/列表/回收站同一 h-11 头部规格，含计数。 */}
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
              <h2 className="flex items-center gap-2 text-[13px] font-medium">
                <FilePenLine className="size-4" />
                本地草稿
              </h2>
              <small className="text-[12px] text-ink-3">{localDrafts.length} 份</small>
            </div>
            <div className="min-h-0 flex-1 p-4">
              {draftError && (
                <p role="alert" className="text-[13px] text-red">
                  {draftError}
                </p>
              )}
              {!localDrafts.length && <p className="text-[13px] text-ink-3">暂无草稿</p>}
              {localDrafts.map((item) => (
                <div key={item.id} className="flex items-center gap-2 border-b py-3">
                  <button
                    disabled={openingDraft}
                    className="min-w-0 flex-1 rounded text-left transition-colors hover:bg-hover-2"
                    onClick={() => void editDraft(item.id)}
                  >
                    <strong className="block truncate text-[13px]">
                      {item.subject || '(无主题)'}
                    </strong>
                    <span className="block truncate text-[12px] text-ink-3">
                      {item.recipientText || '未填写收件人'} ·{' '}
                      {new Date(item.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <button
                    aria-label="删除草稿"
                    title="删除草稿"
                    className="rounded p-2 hover:bg-hover-2"
                    onClick={() => {
                      if (!window.confirm('删除这份本地草稿？')) return;
                      void dela.mail
                        .deleteDraft(item.id)
                        .then(() =>
                          setLocalDrafts((items) => items.filter((row) => row.id !== item.id)),
                        )
                        .catch((reason) => setDraftError(String(reason)));
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
                className={cn(stacked && stackedPlacement, stacked && mobileReading && 'hidden')}
                items={trashItems}
                loading={trashLoading}
                error={trashError}
                selectedMessageId={selectedMessageId}
                onOpen={(id) => {
                  setMobileReading(stacked);
                  void openMessage(id, { readonly: true });
                }}
                onRestore={(item) => void handleRestore(item)}
                onPurge={(item) => void handlePurge(item)}
                onEmpty={() => void handleEmptyTrash()}
              />
            ) : (
              <MailMessageList
                className={cn(stacked && stackedPlacement, stacked && mobileReading && 'hidden')}
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
                  setMobileReading(stacked);
                  void openMessage(id);
                }}
              />
            )}
            <Resizer
              className={stacked ? 'hidden' : 'bg-border/60'}
              label="调整邮件列表宽度"
              max={480}
              min={320}
              onChange={setListWidth}
              onResizingChange={setListResizing}
              value={listWidth}
            />

            <MailReader
              className={cn(stacked && stackedPlacement, stacked && !mobileReading && 'hidden')}
              detail={detail}
              detailLoading={detailLoading}
              detailError={detailError}
              accountAddress={account?.address ?? ''}
              selectedMessageId={selectedMessageId}
              openMessage={openMessage}
              downloadAttachment={(messageId, part) =>
                dela.mail.downloadAttachment(messageId, part)
              }
              onReply={handleReply}
              onDelete={(target) => void handleDeleteMessage(target)}
              readOnly={readingTrash}
              showBackButton={stacked}
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
          drawerSlot,
        )}
      {sendNotice && (
        <p className="pointer-events-none absolute right-5 bottom-5 rounded-control bg-(--tooltip-bg) px-3 py-2 text-[12px] text-(--tooltip-fg) shadow-raised animate-[pop-in_160ms_var(--ease-out-strong)_both]">
          {sendNotice}
        </p>
      )}
    </div>
  );
}
