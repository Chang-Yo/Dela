// 工作台装配层：三个内容 Provider（chat/note/preview）挂在工作台根部，目录侧栏、
// EntryDialogs 与导航脉冲消费都在这里（保持 app/App.tsx 小）；布局与标签本体在 workbench/。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DocumentContent, WorkspaceEntry } from '../../shared/api';
import type { TabId } from '../../shared/layout';
import { isRelativeAssetPath, noteAssetUrl } from '../../shared/note-files';
import { parseRemoteNodeId, remoteAssetUrl } from '../../shared/remotes';
import type { ResourceRef } from '../../shared/resources';
// Provider 均取自轻量叶子模块：barrel 会连带重依赖标签组件（Streamdown/CodeMirror/
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
import { useLocalReferences, useRemoteReferences } from '../navigation/remote-references';
import { documentTabId, useNavigationStore } from '../navigation/view';
import { showToast } from '../app/toasts';
import { MailDraftDialog } from '../app/mail-draft-dialog';
import { ChatHome } from '../content/chat/ChatHome';
import { referenceEntryCandidates } from '../content/chat/reference-tokens';
import { currentContainerOf, WorkbenchExplorer } from './WorkbenchExplorer';
import { openTarget } from './open-target';

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

  // 导航脉冲消费：等工作台布局载入当前项目后再开标签，避免 init 覆盖掉新开的标签。
  // useLayoutEffect：布局已预热时开标签须赶在首帧绘制前，否则先画一帧空组再跳到会话标签。
  useLayoutEffect(() => {
    const layout = useWorkbenchLayout.getState();
    // 子组件的 init effect 已开始加载时，本次 render 的 ready 仍可能是旧值。
    if (!reveal || !layout.ready || layout.projectId !== projectId) return;
    openTarget(reveal.tabId);
    if (reveal.keep) layout.keepTab(reveal.tabId);
    useNavigationStore.getState().consumeReveal();
  }, [reveal, ready, layoutProjectId, projectId]);

  useEffect(() => {
    if (!createProject || !loaded) return;
    setDialog({ action: 'project', id: null });
    useNavigationStore.getState().setCreateProject(false);
  }, [createProject, loaded]);

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

  const onCreated = async (entry: WorkspaceEntry) => {
    if (entry.kind === 'project') return; // EntryDialogs 已回调 onOpenProject。
    if (window.dela?.workspace.localAncestors && entry.path) {
      try {
        useWorkspaceStore
          .getState()
          .rememberEntries(await window.dela.workspace.localAncestors(entry.id));
      } catch (error) {
        useWorkspaceStore.getState().setError(error);
      }
    }
    // 名称可带子路径（a/b/c.md）：沿祖先链全部展开并选中，新条目才看得见。
    if (entry.kind === 'file' || entry.kind === 'folder')
      useTreeState
        .getState()
        .reveal(ancestorChainOf(useWorkspaceStore.getState().workspace.entries, entry.id));
    // 刚建的文件是要写的：直接常驻打开，不当预览。
    if (entry.kind === 'file') useWorkbenchLayout.getState().openTab(documentTabId(entry.id));
    else if (entry.parentId) useTreeState.getState().expand(entry.parentId, true);
  };

  const onRemoved = (liveIds: Set<string>) => {
    const layout = useWorkbenchLayout.getState();
    const keep = (tabId: TabId) =>
      tabId.startsWith('chat:') ||
      tabId.startsWith('preview:source:') ||
      liveIds.has(tabId.slice(tabId.indexOf(':') + 1));
    for (const group of walkGroups(layout.root))
      for (const tab of group.tabs) if (!keep(tab)) layout.closeTab(tab, group.id);
    // 草稿随标签卸载自动冲盘释放（note/drafts 引用计数）。
    if (rootId && !liveIds.has(rootId)) useNavigationStore.getState().openProject('');
  };

  const legacy = useMemo<LegacySeedInput>(() => {
    // 通用工作台承接旧资料页（scope 'sources'）的标签；项目工作台承接各自 view:% 行。
    const scope = projectId ?? 'sources';
    const view = useWorkspaceStore.getState().workspace.views[scope] ?? emptyViewState;
    return {
      scope,
      viewTabs: view.tabs,
      viewActive: view.active,
      resolveEntryKind: (entryId) =>
        documentTabId(entryId).startsWith('note:') ? 'note' : 'preview',
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

  const referenceSource: ReferenceSource = useMemo(
    () => ({
      // @ 引用即文件路径：项目会话列 cwd 下全部文件，通用池排除其他项目目录，
      // key 为绝对路径，title 为相对 cwd 的路径，与 agent 的工作目录一致。订阅 workspace 镜像。
      // 通用池（随聊/资料页）另并入已下载课件候选：课件不在镜像里，按 cwd 过滤永远为空。
      useEntries: (projectId, cwd) => {
        const entries = useWorkspaceStore((state) => state.workspace.entries);
        const courseFiles = useWorkspaceStore((state) => state.courseFiles);
        // 远程项目的 cwd 是远端路径，本地镜像里没有它的文件，候选改由远端索引提供。
        const remote = entries.find((item) => item.id === projectId)?.remoteId;
        const remoteEntries = useRemoteReferences(remote ? projectId : null);
        const localFiles = useLocalReferences(remote ? null : cwd);
        useEffect(() => {
          if (projectId === null && !remote) useWorkspaceStore.getState().ensureCourseFiles();
        }, [projectId, remote]);
        return useMemo(
          () =>
            referenceEntryCandidates(
              [...new Map([...entries, ...localFiles].map((item) => [item.id, item])).values()],
              cwd,
              projectId,
              remote,
              remoteEntries,
              courseFiles,
            ),
          [entries, localFiles, cwd, projectId, remote, remoteEntries, courseFiles],
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
      edit: (key, text) => {
        // 改过的文件不再是「只是看看」：预览标签转常驻，不会被下一次单击替换掉。
        useWorkbenchLayout.getState().keepTab(`note:${key}`);
        useNoteDrafts.getState().edit(key, text);
      },
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
            : entry?.kind === 'file'
              ? { type: 'workspace', id: entry.id }
              : undefined
          : undefined;
      const local = entry?.kind === 'file';
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
    // 工作区镜像载入前不渲染：布局种子与标题解析都依赖条目树。
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
                    onCreated={onCreated}
                    onOpenDocument={(key) => void useNavigationStore.getState().openDocument(key)}
                    onOpenToSide={(key) => openTarget(documentTabId(key), { aside: true })}
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
