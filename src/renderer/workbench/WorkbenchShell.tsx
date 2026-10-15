// 工作台装配层：三个内容 Provider（chat/note/preview）挂在工作台根部，目录侧栏 +
// EntryDialogs + 导航脉冲消费都在这里（保持 app/App.tsx 小）。对照对象是旧
// ProjectView/SourcesView 的装配职责；布局与标签本体在 workbench/（3A）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DocumentContent, WorkspaceEntry } from '../../shared/api';
import type { TabId } from '../../shared/layout';
import { isRelativeAssetPath, noteAssetUrl } from '../../shared/note-files';
import { parseRemoteNodeId, remoteAssetUrl } from '../../shared/remotes';
import type { ResourceRef } from '../../shared/resources';
// Provider 均取自轻量叶子模块：barrel 会连带重依赖标签组件（Streamdown/milkdown/
// highlight.js），静态引入会让 registry 的懒加载分包失效。
import {
  ChatTabSourceProvider,
  type ChatTabSource,
  type ReferenceSource,
} from '../content/chat/chat-source';
import { NoteDraftSourceProvider, type NoteDraftSource } from '../content/note/draft-source';
import {
  ContentLoaderProvider,
  type ContentLoader,
  type LoadedDocument,
} from '../content/preview/loader';
import { parsePreviewTabId } from '../content/preview/tab-id';
import { useSessions } from '../sessions/store';
import { useWorkbenchLayout } from './layout-store';
import { useShortcuts } from '../app/shortcuts';
import { walkGroups, type LegacySeedInput } from './layout-schema';
import { Workbench } from './Workbench';
import { EntryDialogs, type EntryDialogRequest } from '../workspace/entry-dialogs';
import { prefillNoteText, type EntryAction } from '../workspace/entry-actions';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { useNoteDrafts } from '../content/note/drafts';
import { ancestorChainOf, useNavigationStore as useTreeState } from '../navigation/store';
import { useRemoteReferences } from '../navigation/remote-references';
import { documentTabId, useNavigationStore } from '../navigation/view';
import { showToast } from '../app/toasts';
import { MailDraftDialog } from '../app/mail-draft-dialog';
import { ChatHome } from '../content/chat/ChatHome';
import { referenceCandidates } from '../content/chat/reference-tokens';
import { currentContainerOf, WorkbenchExplorer } from './WorkbenchExplorer';

const emptyViewState = { tabs: [], active: null, expanded: [], scroll: {} };

/** TabId → 旧文档键（entryId 或 source:{sourceId}）；chat 无对应文档。 */
function tabDocumentKey(tabId: TabId | null): string | null {
  if (!tabId) return null;
  if (tabId.startsWith('preview:')) return tabId.slice('preview:'.length);
  if (tabId.startsWith('note:')) return tabId.slice('note:'.length);
  return null;
}

/** 空组空态的「新建对话」：与侧栏同一入口，按当前池落位（项目内落焦点组，通用池分屏）。
 *  模块级函数引用稳定，不破坏 SplitNode/TabGroup 的 memo 比较。 */
function newChatInCurrentPool() {
  void useNavigationStore.getState().newChat(useWorkbenchLayout.getState().projectId);
}

export function WorkbenchShell({ home = false }: { home?: boolean }) {
  const projectId = useNavigationStore((s) => (home ? null : s.projectId));
  const reveal = useNavigationStore((s) => s.reveal);
  const generalChat = useNavigationStore((s) => s.generalChat);
  const createProject = useNavigationStore((s) => s.createProject);
  const ready = useWorkbenchLayout((s) => s.ready);
  const layoutProjectId = useWorkbenchLayout((s) => s.projectId);
  const loaded = useWorkspaceStore((s) => s.loaded);
  // 订阅键位表：用户改键后工作台快捷键立即跟随（Workbench 不自行订阅 app 的 store）。
  const bindings = useShortcuts((s) => s.bindings);
  const workspaceError = useWorkspaceStore((s) => s.error);
  // 订阅镜像仅为让标签标题随条目/会话变化重渲染（registry 的 title 是同步读取）。
  useWorkspaceStore((s) => s.workspace.entries);
  useSessions((s) => s.lists);
  const [dialog, setDialog] = useState<EntryDialogRequest | null>(null);

  const activeTab = useWorkbenchLayout((s) => {
    const group = walkGroups(s.root).find((node) => node.id === s.focus);
    return group?.active ?? null;
  });
  const activeDocKey = tabDocumentKey(activeTab);
  // 当前文档键经 ref 读取：chatSource/draftSource 不随切标签重建（Provider 值一变，
  // 全部 ChatTab/NoteTab 都会重渲）。
  const activeDocKeyRef = useRef(activeDocKey);
  activeDocKeyRef.current = activeDocKey;
  const rootId = useWorkspaceStore((s) =>
    s.workspace.entries.some((entry) => entry.id === projectId) ? projectId : null,
  );

  // -------------------------------------------------------------------------
  // 导航脉冲消费：等工作台布局载入当前项目后再开标签，避免 init 覆盖掉新开的标签。
  // useLayoutEffect：从首页主动打开会话或文档时布局已预热就绪，开标签须赶在
  // 首帧绘制前，否则先画一帧空组再跳到会话标签。
  // -------------------------------------------------------------------------
  useLayoutEffect(() => {
    const layout = useWorkbenchLayout.getState();
    // 子组件的 init effect 已开始加载时，本次 render 的 ready 仍可能是旧值。
    if (!reveal || !layout.ready || layout.projectId !== projectId) return;
    layout.openTab(reveal.tabId);
    useNavigationStore.getState().consumeReveal();
  }, [reveal, ready, layoutProjectId, projectId]);

  useEffect(() => {
    if (home || !generalChat || !ready || layoutProjectId !== null) return;
    let active = true;
    void (async () => {
      const dela = window.dela;
      const navigation = useNavigationStore.getState();
      if (!dela) {
        navigation.consumeGeneralChat();
        return;
      }
      try {
        let sessionId: string | null = null;
        if (!generalChat.create) {
          // 优先定位已打开的通用会话标签；镜像未载入时先读一次列表。
          await useSessions.getState().refresh(null);
          const generalIds = new Set(
            (useSessions.getState().lists.general ?? []).map((session) => session.id),
          );
          sessionId =
            walkGroups(useWorkbenchLayout.getState().root)
              .flatMap((group) => group.tabs)
              .map((tab) => (tab.startsWith('chat:') ? tab.slice('chat:'.length) : null))
              .find((id) => id !== null && generalIds.has(id)) ?? null;
        }
        if (!sessionId) {
          // 这里是资料页（通用工作台）的通用池，新会话落在资料树的课程目录。
          const chat = await dela.session.create(null, 'library');
          if (!chat.sessionId) throw new Error('会话创建失败');
          useSessions.getState().putChat(chat.sessionId, chat);
          void useSessions
            .getState()
            .refresh(null)
            .catch(() => {});
          sessionId = chat.sessionId;
        }
        if (active) {
          useWorkbenchLayout.getState().openTab(`chat:${sessionId}`);
          useNavigationStore.getState().consumeGeneralChat();
        }
      } catch (cause) {
        if (active)
          showToast({ variant: 'error', title: '新建会话失败', description: errorText(cause) });
        useNavigationStore.getState().consumeGeneralChat();
      }
    })();
    return () => {
      active = false;
    };
  }, [home, generalChat, ready, layoutProjectId]);

  useEffect(() => {
    if (!createProject || !loaded) return;
    setDialog({ action: 'project', id: null });
    useNavigationStore.getState().setCreateProject(false);
  }, [createProject, loaded]);

  // -------------------------------------------------------------------------
  // 弹窗接线（workspace/entry-dialogs 的回调由这里接手旧 ProjectView 的后续动作）。
  // -------------------------------------------------------------------------
  const openDialog = useCallback(
    (action: EntryAction | 'link' | 'connect', id: string | null, text?: string) =>
      setDialog({
        action,
        id,
        text,
        initialTarget:
          action === 'move' || action === 'link'
            ? (currentContainerOf(
                useTreeState.getState().selected ?? activeDocKeyRef.current,
                rootId,
              ) ?? '')
            : undefined,
      }),
    [rootId],
  );

  const onCreated = (entry: WorkspaceEntry) => {
    if (entry.kind === 'project') return; // EntryDialogs 已回调 onOpenProject。
    if (entry.kind === 'note') useWorkbenchLayout.getState().openTab(`note:${entry.id}`);
    else if (entry.kind === 'folder') {
      const tree = useTreeState.getState();
      tree.select(entry.id);
      if (entry.parentId) tree.expand(entry.parentId, true);
    } else if (entry.parentId) {
      useTreeState.getState().expand(entry.parentId, true);
    }
  };

  const onRemoved = (liveIds: Set<string>) => {
    const layout = useWorkbenchLayout.getState();
    const keep = (tabId: TabId) =>
      tabId.startsWith('chat:') ||
      tabId.startsWith('preview:source:') ||
      liveIds.has(tabId.slice(tabId.indexOf(':') + 1));
    for (const group of walkGroups(layout.root))
      for (const tab of group.tabs) if (!keep(tab)) layout.closeTab(tab, group.id);
    // 草稿随标签卸载自动冲盘释放（note/drafts 引用计数）；当前项目被删则回通用池。
    if (rootId && !liveIds.has(rootId)) useNavigationStore.getState().openProject('');
  };

  // -------------------------------------------------------------------------
  // 三个内容 Provider 的装配。
  // -------------------------------------------------------------------------
  const legacy = useMemo<LegacySeedInput>(() => {
    // 通用工作台承接旧资料页（scope 'sources'）的标签；项目工作台承接各自 view:% 行。
    const scope = projectId ?? 'sources';
    const view = useWorkspaceStore.getState().workspace.views[scope] ?? emptyViewState;
    return {
      scope,
      viewTabs: view.tabs,
      viewActive: view.active,
      resolveEntryKind: (entryId) =>
        useWorkspaceStore.getState().workspace.entries.find((e) => e.id === entryId)?.kind ===
        'note'
          ? 'note'
          : 'preview',
    };
  }, [projectId, loaded]);

  // -------------------------------------------------------------------------
  // 布局预热（含 home 视图）：home 不挂载 Workbench，若等主动进入工作台才载布局，
  // 切换瞬间工作台空白一次（ready=false → IPC → 标签经 reveal 重开），观感如同整页重载。
  // init 对已就绪的同项目布局早退，视图往复切换不重复走 IPC。
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!loaded) return;
    void useWorkbenchLayout.getState().init(projectId, legacy);
  }, [loaded, projectId, legacy]);

  // 笔记 Crepe 会话回收：会话键 = `${tabId}:${groupId}`，随布局树存活（NoteEditor 模块级
  // Map）。树中消失的 note: 标签（关闭/跨组移动/项目切换换树/条目删除连带关标签）在此
  // 销毁实例，否则无限滞留；动态 import 取 forgetNoteEditorState，不破坏 registry 懒加载分包。
  useEffect(
    () =>
      useWorkbenchLayout.subscribe((state, prev) => {
        if (state.root === prev.root) return;
        const alive = new Set(
          walkGroups(state.root).flatMap((group) => group.tabs.map((tab) => `${tab}:${group.id}`)),
        );
        const orphans = walkGroups(prev.root).flatMap((group) =>
          group.tabs
            .filter((tab) => tab.startsWith('note:'))
            .map((tab) => `${tab}:${group.id}`)
            .filter((key) => !alive.has(key)),
        );
        if (orphans.length)
          void import('../content/note/index').then((note) => {
            for (const key of orphans) note.forgetNoteEditorState(key);
          });
      }),
    [],
  );

  const referenceSource: ReferenceSource = useMemo(
    () => ({
      // @ 引用即文件路径：只列会话 cwd 之下、且不属于其他项目目录的文件（项目会话 = 项目目录），
      // key 为绝对路径，title 为相对 cwd 的路径，与 agent 的工作目录一致。订阅 workspace 镜像。
      useEntries: (projectId, cwd) => {
        const entries = useWorkspaceStore((state) => state.workspace.entries);
        // 远程项目的 cwd 是远端路径，本地镜像里没有它的文件，候选改由远端索引提供。
        const remote = entries.find((item) => item.id === projectId)?.remoteId;
        const remoteEntries = useRemoteReferences(remote ? projectId : null);
        return useMemo(
          () => (remote ? remoteEntries : referenceCandidates(entries, cwd, projectId)),
          [entries, cwd, projectId, remote, remoteEntries],
        );
      },
      // 发送前冲盘引用笔记；仍无法保存时抛错阻止发送。
      flushReference: async (key) => {
        if (!(await useNoteDrafts.getState().save(key)))
          throw new Error('引用的笔记尚未保存成功，请先保存或移除该引用');
      },
    }),
    [],
  );

  const chatSource = useMemo<ChatTabSource>(
    () => ({
      referenceSource,
      mailDialog: MailDraftDialog,
      onOpenSource: (key) => void useNavigationStore.getState().openDocument(key),
      onSaveNote: (text) =>
        openDialog(
          'note',
          currentContainerOf(useTreeState.getState().selected ?? activeDocKeyRef.current, rootId),
          prefillNoteText(activeDocKeyRef.current, text),
        ),
    }),
    [openDialog, referenceSource, rootId],
  );

  const draftSource = useMemo<NoteDraftSource>(
    () => ({
      usePath: (entryId) => {
        const entries = useWorkspaceStore((state) => state.workspace.entries);
        return ancestorChainOf(entries, entryId).flatMap((id) => {
          const entry = entries.find((entry) => entry.id === id);
          return entry ? [entry.name] : [];
        });
      },
      useDraft: (entryId) => useNoteDrafts((state) => state.drafts[entryId]),
      acquire: (key, force) => useNoteDrafts.getState().acquire(key, force),
      release: (key) => useNoteDrafts.getState().release(key),
      edit: (key, text) => useNoteDrafts.getState().edit(key, text),
      save: (key) => useNoteDrafts.getState().save(key),
      saveAsNewNote: (entryId, text) =>
        openDialog(
          'note',
          currentContainerOf(useTreeState.getState().selected ?? activeDocKeyRef.current, rootId),
          prefillNoteText(entryId, text),
        ),
    }),
    [openDialog, rootId],
  );

  const loader = useMemo<ContentLoader>(() => {
    /** 文档读取路径与旧 ProjectDocument/SourceDetail 一致：source: → canvas/水源，条目 → workspace。 */
    const loadDocument = async (tabKey: TabId): Promise<LoadedDocument> => {
      const target = parsePreviewTabId(tabKey);
      if (!target) throw new Error('无效的预览标签');
      const dela = window.dela;
      if (!dela) throw new Error('文件预览仅在桌面端可用');
      const entries = useWorkspaceStore.getState().workspace.entries;
      let sourceId: string | null = null;
      let entry: WorkspaceEntry | undefined;
      let entryId: string | null = null;
      if ('sourceId' in target) sourceId = target.sourceId;
      else {
        entryId = target.entryId;
        // 远端文件不在条目树里：读取走远端只读通道（远端内容变了不自动重读，需要时重开标签）。
        const remote = parseRemoteNodeId(entryId);
        if (remote) {
          const root = entries.find((e) => e.id === remote.projectId)?.path ?? '/';
          const content = await dela.workspace.readRemoteDocument(remote.projectId, remote.path);
          return {
            content,
            watchesDisk: false,
            // Markdown 里的相对图片同样从远端取（越界路径由主进程拒绝，这里保持原样）。
            resolveImage: (src) =>
              isRelativeAssetPath(src)
                ? remoteAssetUrl(remote.projectId, root, remote.path, src)
                : src,
          };
        }
        entry = entries.find((e) => e.id === entryId);
        sourceId = entry?.sourceId ?? null;
      }
      const content: DocumentContent = sourceId
        ? sourceId.startsWith('shuiyuan-topic:')
          ? await dela.shuiyuan.readSource(Number(sourceId.slice('shuiyuan-topic:'.length)))
          : await dela.canvas.read(sourceId)
        : await dela.workspace.read(entryId!);
      // pptx 的导出/快速预览定位：Canvas 资料用 sourceId，本地条目用条目 id。
      const officeRef: ResourceRef | undefined =
        content.format === 'pptx'
          ? sourceId && !sourceId.startsWith('shuiyuan-topic:')
            ? { type: 'canvas', id: sourceId }
            : entry && (entry.kind === 'local' || entry.kind === 'imported')
              ? { type: 'workspace', id: entry.id }
              : undefined
          : undefined;
      const local = entry?.kind === 'local' || entry?.kind === 'imported';
      return {
        content,
        shuiyuanTopicId: sourceId?.startsWith('shuiyuan-topic:')
          ? Number(sourceId.slice('shuiyuan-topic:'.length))
          : undefined,
        officeRef,
        watchesDisk: local,
        resolveImage:
          entry && local
            ? (src) => (isRelativeAssetPath(src) ? noteAssetUrl(entry.id, src) : src)
            : undefined,
      };
    };
    return {
      loadDocument,
      openLink: (url) => {
        try {
          const parsed = new URL(url);
          const file =
            parsed.origin === 'https://oc.sjtu.edu.cn'
              ? parsed.pathname.match(/\/files\/(\d+)/)?.[1]
              : null;
          if (
            file &&
            useWorkspaceStore.getState().canvas.items.some((i) => i.sourceId === `file:${file}`)
          ) {
            void useNavigationStore.getState().openDocument(`source:file:${file}`);
            return;
          }
          void window.dela?.canvas
            .openLink(url)
            .catch((cause) =>
              showToast({ variant: 'error', title: '打开链接失败', description: errorText(cause) }),
            );
        } catch {
          showToast({ variant: 'error', title: '打开链接失败', description: '不支持的链接' });
        }
      },
      openShuiyuanTopic: (topicId, postNumber) =>
        useNavigationStore.getState().openShuiyuanTopic(topicId, postNumber),
      onExported: () => {
        // 导出会在我的资料里新增「预览导出」条目，目录树需一并刷新。
        void useWorkspaceStore
          .getState()
          .refresh()
          .catch((cause) =>
            showToast({ variant: 'error', title: '刷新目录失败', description: errorText(cause) }),
          );
      },
    };
  }, []);

  if (!loaded && workspaceError === null && window.dela)
    // 工作区镜像载入前不渲染：布局种子与标题解析都依赖条目树（旧 ProjectView 的
    // workspaceLoaded 种子门控）。
    return <div className="min-h-0 flex-1 bg-surface" />;

  return (
    <ChatTabSourceProvider source={chatSource}>
      <NoteDraftSourceProvider source={draftSource}>
        <ContentLoaderProvider loader={loader}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {workspaceError && (
              <p className="px-4 py-2 text-13 text-red" role="alert">
                {workspaceError}
              </p>
            )}
            <div className="relative flex min-h-0 flex-1">
              {home ? (
                <ChatHome />
              ) : (
                <>
                  <WorkbenchExplorer
                    activeDocKey={activeDocKey}
                    onAction={openDialog}
                    onOpenDocument={(key) => void useNavigationStore.getState().openDocument(key)}
                    onOpenToSide={(key) => {
                      // 「在另一栏打开」：先在当前组激活标签再分屏（新组复制活动标签，手动分屏语义）。
                      const tabId = documentTabId(key);
                      const store = useWorkbenchLayout.getState();
                      store.openTab(tabId, store.focus);
                      store.splitGroup(store.focus, 'vertical');
                    }}
                    projectId={projectId}
                  />
                  <Workbench bindings={bindings} onNewChat={newChatInCurrentPool} />
                </>
              )}
            </div>
            <EntryDialogs
              onClose={() => setDialog(null)}
              onCreated={onCreated}
              onOpenProject={(id) => void useNavigationStore.getState().openProject(id)}
              onRemoved={onRemoved}
              request={dialog}
            />
          </div>
        </ContentLoaderProvider>
      </NoteDraftSourceProvider>
    </ChatTabSourceProvider>
  );
}
