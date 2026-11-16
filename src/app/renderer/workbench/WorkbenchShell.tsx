// 工作台装配层：三个内容 Provider（chat/note/preview）挂在工作台根部，目录侧栏、
// EntryDialogs 都在这里（保持 app/App.tsx 小）；布局与标签本体在 workbench/。
import { useEffect, type ReactNode } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  type DocumentContent,
  type WorkspaceEntry,
  type TabId,
  decodeAssetPath,
  isRelativeAssetPath,
  noteAssetUrl,
  type ResourceRef,
} from '../../../modules/workspace/contract';
import { parseRemoteNodeId, remoteAssetUrl } from '../../../modules/remotes/contract';
// 模块出口里的标签组件懒加载，这里静态引入 Provider 不影响 registry 的分包。
import {
  ChatTabSourceProvider,
  type ChatTabSource,
  type ReferenceEntry,
  type ReferenceSource,
  useSessions,
  ChatHome,
  referenceEntryCandidates,
} from '../../../modules/chat/view';
import {
  NoteDraftSourceProvider,
  useNoteDrafts,
  type NoteDraftSource,
} from '../../../modules/note/view';
import {
  ContentLoaderProvider,
  parsePreviewTabId,
  type ContentLoader,
  type LoadedDocument,
} from '../../../modules/preview/view';
import { closeTabEverywhere, useWorkbenchLayout } from './layout-store';
import { useShortcuts } from '../shell/shortcuts';
import { walkGroups } from './layout-schema';
import { purgeRemovedEntries } from './removed-cleanup';
import { Workbench } from './Workbench';
import { EntryDialogs } from '../workspace/entry-dialogs';
import { useEntryDialog } from '../workspace/entry-dialog-store';
import { prefillNoteText, type EntryAction } from '../workspace/entry-actions';
import { ancestorChainOf, useTreeState } from '../navigation/store';
import { useLocalReferences, useRemoteReferences } from '../navigation/remote-references';
import { documentTabId, useNavigationStore } from '../navigation/view';
import { showToast } from '../../../ui/toast';
import { MailDraftDialog } from '../../../modules/mail/view';
import { currentContainerOf, WorkbenchExplorer } from './WorkbenchExplorer';
import { openTarget } from './open-target';
import { ErrorText } from '../../../ui/alert';
import { officeRefOf, opensInApp, referenceQueries, sourceOf, sourceOfLink } from '../../views';
import { workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import { errorMessage } from '../../../core/protocol/contract';

/** TabId → 旧文档键（entryId 或 source:{sourceId}）；chat 无对应文档。 */
function tabDocumentKey(tabId: TabId | null): string | null {
  if (!tabId) return null;
  if (tabId.startsWith('preview:')) return tabId.slice('preview:'.length);
  if (tabId.startsWith('note:')) return tabId.slice('note:'.length);
  return null;
}

const flattenReferences = (results: Array<{ data?: Array<{ path: string; title: string }> }>) =>
  results.flatMap((result) => result.data ?? []);

/** 空组空态的「新建对话」：与侧栏同一入口，按当前池落位（项目内落焦点组，通用池分屏）。 */
function newChatInCurrentPool() {
  void useNavigationStore.getState().newChat(useWorkbenchLayout.getState().projectId);
}

// 注入给标签的 hook 定义在模块级：组件体里的 hook 函数表达式会让编译器放弃整个 WorkbenchShell。
function useReferenceEntries(projectId: string | null, cwd: string | null) {
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const remote = entries.find((item) => item.id === projectId)?.remoteId;
  const remoteEntries = useRemoteReferences(remote ? projectId : null);
  const localFiles = useLocalReferences(remote ? null : cwd);
  const workspaceDirectory = useWorkspaceStore((state) => state.workspace.directory);
  const workspaceRoot =
    projectId === null && !remote && workspaceDirectory
      ? `${workspaceDirectory}${workspaceDirectory.includes('\\') ? '\\' : '/'}workspace`
      : null;
  const workspaceFiles = useLocalReferences(workspaceRoot);
  const courseFiles = useQueries({
    queries: referenceQueries.map((query) => ({
      ...query,
      enabled: projectId === null && !remote,
      staleTime: 30_000,
    })),
    combine: flattenReferences,
  });
  return referenceEntryCandidates(
    [
      ...new Map(
        [...entries, ...localFiles, ...workspaceFiles].map((item) => [item.id, item]),
      ).values(),
    ],
    cwd,
    projectId,
    remote,
    remoteEntries,
    courseFiles,
    workspaceRoot,
  );
}

function ReferenceEntries({
  projectId,
  cwd,
  children,
}: {
  projectId: string | null;
  cwd: string | null;
  children: (entries: ReferenceEntry[]) => ReactNode;
}) {
  return children(useReferenceEntries(projectId, cwd));
}

// @ 引用候选即 cwd 下的文件路径；通用池另并入资料目录与模块登记的候选，如已下载的课件。
const referenceSource: ReferenceSource = {
  Entries: ReferenceEntries,
  // 发送前冲盘引用笔记；仍无法保存时抛错阻止发送。
  flushReference: async (key) => {
    if (!(await useNoteDrafts.getState().save(key)))
      throw new Error('引用的笔记尚未保存成功，请先保存或移除该引用');
  },
};

const draftBase: Omit<NoteDraftSource, 'saveAsNewNote'> = {
  resolveImage: (entryId, src) => {
    if (!isRelativeAssetPath(src)) return src;
    const remote = parseRemoteNodeId(entryId);
    if (!remote) return noteAssetUrl(entryId, decodeAssetPath(src));
    const root =
      useWorkspaceStore.getState().workspace.entries.find((e) => e.id === remote.projectId)?.path ??
      '/';
    return remoteAssetUrl(remote.projectId, root, remote.path, src);
  },
  acquire: (key, force) => useNoteDrafts.getState().acquire(key, force),
  release: (key) => useNoteDrafts.getState().release(key),
  edit: (key, text) => {
    // 改过的文件不再是「只是看看」：预览标签转常驻，不会被下一次单击替换掉。
    useWorkbenchLayout.getState().keepTab(`note:${key}`);
    useNoteDrafts.getState().edit(key, text);
  },
  save: (key) => useNoteDrafts.getState().save(key),
};

export function WorkbenchShell({ home }: { home?: boolean }) {
  const projectId = useNavigationStore((s) => (home ? null : s.projectId));
  const generalChat = useNavigationStore((s) => s.generalChat);
  const loaded = useWorkspaceStore((s) => s.loaded);
  // 订阅键位表：用户改键后工作台快捷键立即跟随（Workbench 不自行订阅 app 的 store）。
  const bindings = useShortcuts((s) => s.bindings);
  const workspaceError = useWorkspaceStore((s) => s.error);
  // 订阅镜像仅为让标签标题随条目/会话变化重渲染（registry 的 title 是同步读取）。
  useWorkspaceStore((s) => s.workspace.entries);
  useSessions((s) => s.lists);
  const dialog = useEntryDialog((s) => s.request);
  const queryClient = useQueryClient();

  const activeTab = useWorkbenchLayout((s) => {
    const group = walkGroups(s.root).find((node) => node.id === s.focus);
    return group?.active ?? null;
  });
  const activeDocKey = tabDocumentKey(activeTab);
  const rootId = useWorkspaceStore((s) =>
    s.workspace.entries.some((entry) => entry.id === projectId) ? projectId : null,
  );

  const openDialog = (action: EntryAction | 'link', id: string | null, text?: string) =>
    useEntryDialog.getState().open({
      action,
      id,
      text,
      initialTarget:
        action === 'move' || action === 'link'
          ? (currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId) ?? '')
          : undefined,
    });

  const onCreated = async (entry: WorkspaceEntry) => {
    if (entry.kind === 'project') return; // EntryDialogs 已回调 onOpenProject。
    if (window.dela && entry.path) {
      try {
        useWorkspaceStore
          .getState()
          .rememberEntries(await workspaceClient.localAncestors(entry.id));
      } catch (error) {
        useWorkspaceStore.getState().setError(error);
      }
    }
    // 名称可带子路径（a/b/c.md）：沿祖先链全部展开并选中，新条目才看得见。
    if (entry.kind === 'file' || entry.kind === 'folder')
      useTreeState
        .getState()
        .reveal(ancestorChainOf(useWorkspaceStore.getState().workspace.entries, entry.id));
    if (entry.kind === 'file') useWorkbenchLayout.getState().openTab(documentTabId(entry.id));
    else if (entry.parentId) useTreeState.getState().expand(entry.parentId, true);
  };

  const onRemoved = (liveIds: Set<string>) => purgeRemovedEntries(liveIds);

  // home 也预热布局，切进工作台时不会先闪一帧空白；同项目重复 init 会早退。
  useEffect(() => {
    if (!loaded) return;
    void useWorkbenchLayout.getState().init(projectId);
  }, [loaded, projectId]);

  const chatSource: ChatTabSource = {
    referenceSource,
    mailDialog: MailDraftDialog,
    navigate: (target) => useNavigationStore.getState().navigate(target),
    workbench: {
      open: (tab, options) => openTarget(tab, options),
      openDocument: (key, options) =>
        options?.aside
          ? openTarget(documentTabId(key), { aside: true })
          : void useNavigationStore.getState().openDocument(key),
      close: closeTabEverywhere,
    },
    opensLink: opensInApp,
    onSaveNote: (text) =>
      openDialog(
        'note',
        currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId),
        prefillNoteText(activeDocKey, text, queryClient),
      ),
  };

  const draftSource: NoteDraftSource = {
    ...draftBase,
    saveAsNewNote: (entryId, text) =>
      openDialog(
        'note',
        currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId),
        prefillNoteText(entryId, text, queryClient),
      ),
  };

  const loader: ContentLoader = {
    loadDocument: async (tabKey: TabId): Promise<LoadedDocument> => {
      const target = parsePreviewTabId(tabKey);
      if (!target) throw new Error('无效的预览标签');
      if (!window.dela) throw new Error('文件预览仅在桌面端可用');
      const entries = useWorkspaceStore.getState().workspace.entries;
      let sourceId: string | null = null;
      let entry: WorkspaceEntry | undefined;
      let entryId: string | null = null;
      if ('sourceId' in target) sourceId = target.sourceId;
      else {
        entryId = target.entryId;
        // 远端文件不在条目树里：读取走远端只读通道（远端内容变了不自动重读，需要时重开标签）。
        const remote = parseRemoteNodeId(entryId);
        if (remote)
          return {
            content: await workspaceClient.readRemoteDocument(remote),
            watchesDisk: false,
          };
        entry = entries.find((e) => e.id === entryId);
        sourceId = entry?.sourceId ?? null;
      }
      const content: DocumentContent = sourceId
        ? await workspaceClient.readSource(sourceId)
        : await workspaceClient.read(entryId!);
      const document = sourceId ? sourceOf(sourceId)?.document : undefined;
      const officeRef: ResourceRef | undefined =
        content.format === 'pptx'
          ? sourceId && !document
            ? officeRefOf(sourceId)
            : entry?.kind === 'file'
              ? { type: 'workspace', id: entry.id }
              : undefined
          : undefined;
      return {
        content,
        source: sourceId && document ? { id: sourceId, document } : undefined,
        officeRef,
        watchesDisk: entry?.kind === 'file',
      };
    },
    // 已同步的资料在标签页打开；其余交给主进程按模块分流，最后才是系统浏览器。
    openLink: (url) => {
      const sourceId = sourceOfLink(url, queryClient);
      if (sourceId) void useNavigationStore.getState().openDocument(`source:${sourceId}`);
      else window.open(url);
    },
    navigate: (target) => useNavigationStore.getState().navigate(target),
    onExported: () => {
      // 导出会在我的资料里新增「预览导出」条目，目录树需一并刷新。
      void useWorkspaceStore
        .getState()
        .refresh()
        .catch((cause) =>
          showToast({
            variant: 'error',
            title: '刷新目录失败',
            description: errorMessage(cause),
          }),
        );
    },
  };

  if (!loaded && workspaceError === null && window.dela)
    // 工作区镜像载入前不渲染：布局种子与标题解析都依赖条目树。
    return <div className="min-h-0 flex-1 bg-surface" />;

  return (
    <ChatTabSourceProvider source={chatSource}>
      <NoteDraftSourceProvider source={draftSource}>
        <ContentLoaderProvider loader={loader}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {workspaceError && (
              <ErrorText size="sm" className="px-4 py-2">
                {workspaceError}
              </ErrorText>
            )}
            <div className="relative flex min-h-0 flex-1">
              {home ? (
                <ChatHome request={generalChat} />
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
              onClose={() => useEntryDialog.getState().close()}
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
