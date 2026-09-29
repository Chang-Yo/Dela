// 工作台装配层：三个内容 Provider（chat/note/preview）挂在工作台根部，目录侧栏 +
// EntryDialogs + 导航脉冲消费都在这里（保持 app/App.tsx 小）。对照对象是旧
// ProjectView/SourcesView 的装配职责；布局与标签本体在 workbench/（3A）。
import { useEffect, useMemo, useState } from 'react';
import type { DocumentContent, WorkspaceEntry } from '../../shared/api';
import type { TabId } from '../../shared/layout';
import { isRelativeAssetPath, noteAssetUrl } from '../../shared/note-files';
import type { ResourceRef } from '../../shared/resources';
import { ChatTabSourceProvider, type ChatTabSource, type ReferenceSource } from '../content/chat';
import { NoteDraftSourceProvider, type NoteDraftSource } from '../content/note';
import {
  ContentLoaderProvider,
  parsePreviewTabId,
  type ContentLoader,
  type LoadedDocument,
} from '../content/preview';
import { useSessions } from '../sessions/store';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { walkGroups, type LegacySeedInput } from '../workbench/layout-schema';
import { Workbench } from '../workbench/Workbench';
import { EntryDialogs, type EntryDialogRequest } from '../workspace/entry-dialogs';
import { prefillNoteText, type EntryAction } from '../workspace/entry-actions';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { useNoteDrafts } from '../workspace/drafts';
import { useNavigationStore as useTreeState } from '../navigation/store';
import { documentTabId, useNavigationStore } from './navigation';
import { MailDraftDialog } from './mail-draft-dialog';
import { currentContainerOf, WorkbenchExplorer } from './workbench-explorer';

const emptyViewState = { tabs: [], active: null, expanded: [], scroll: {} };

/** TabId → 旧文档键（entryId 或 source:{sourceId}）；chat 无对应文档。 */
function tabDocumentKey(tabId: TabId | null): string | null {
  if (!tabId) return null;
  if (tabId.startsWith('preview:')) return tabId.slice('preview:'.length);
  if (tabId.startsWith('note:')) return tabId.slice('note:'.length);
  return null;
}

export function WorkbenchShell() {
  const projectId = useNavigationStore((s) => s.projectId);
  const reveal = useNavigationStore((s) => s.reveal);
  const generalChat = useNavigationStore((s) => s.generalChat);
  const createProject = useNavigationStore((s) => s.createProject);
  const ready = useWorkbenchLayout((s) => s.ready);
  const layoutProjectId = useWorkbenchLayout((s) => s.projectId);
  const loaded = useWorkspaceStore((s) => s.loaded);
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
  const rootId = useWorkspaceStore((s) =>
    s.workspace.entries.some((entry) => entry.id === projectId) ? projectId : null,
  );

  // -------------------------------------------------------------------------
  // 导航脉冲消费：等工作台布局载入当前项目后再开标签，避免 init 覆盖掉新开的标签。
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!reveal || !ready || layoutProjectId !== projectId) return;
    useWorkbenchLayout.getState().openTab(reveal.tabId);
    useNavigationStore.getState().consumeReveal();
  }, [reveal, ready, layoutProjectId, projectId]);

  useEffect(() => {
    if (!generalChat || !ready || layoutProjectId !== null) return;
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
          const chat = await dela.session.create(null);
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
        if (active) useNavigationStore.getState().setNavigationError(errorText(cause));
        useNavigationStore.getState().consumeGeneralChat();
      }
    })();
    return () => {
      active = false;
    };
  }, [generalChat, ready, layoutProjectId]);

  useEffect(() => {
    if (!createProject || !loaded) return;
    setDialog({ action: 'project', id: null });
    useNavigationStore.getState().setCreateProject(false);
  }, [createProject, loaded]);

  // -------------------------------------------------------------------------
  // 弹窗接线（workspace/entry-dialogs 的回调由这里接手旧 ProjectView 的后续动作）。
  // -------------------------------------------------------------------------
  const openDialog = (action: EntryAction | 'link' | 'connect', id: string | null, text?: string) =>
    setDialog({
      action,
      id,
      text,
      initialTarget:
        action === 'move' || action === 'link'
          ? (currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId) ?? '')
          : undefined,
    });

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
    // 草稿随标签卸载自动冲盘释放（workspace/drafts 引用计数）；当前项目被删则回通用池。
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

  const referenceSource: ReferenceSource = useMemo(
    () => ({
      // @ 引用候选：打开中的文档（有草稿标题）优先，其次可读条目（笔记/导入副本/Canvas 与
      // 水源引用条目）——旧 AgentPanel 的拼装逻辑。
      loadEntries: async () => {
        const openKeys = new Set(
          walkGroups(useWorkbenchLayout.getState().root)
            .flatMap((group) => group.tabs)
            .map((tab) => tabDocumentKey(tab))
            .filter((key): key is string => key !== null),
        );
        const options: { key: string; title: string }[] = [];
        const drafts = useNoteDrafts.getState().drafts;
        for (const key of openKeys) {
          const title = drafts[key]?.content.title;
          if (title) options.push({ key, title });
        }
        const entries = useWorkspaceStore.getState().workspace.entries;
        for (const entry of entries)
          if (
            (entry.kind === 'note' || entry.kind === 'imported' || entry.kind === 'source') &&
            !openKeys.has(entry.id)
          )
            options.push({ key: entry.id, title: entry.name });
        return options;
      },
      // 发送前冲盘引用笔记；仍无法保存时抛错阻止发送（旧 use-chat 的 save + 校验）。
      flushReference: async (key) => {
        if (!(await useNoteDrafts.getState().save(key)))
          throw new Error('引用的笔记尚未保存成功，请先保存或移除该引用');
      },
    }),
    [],
  );

  const chatSource = useMemo<ChatTabSource>(
    () => ({
      projectId,
      referenceSource,
      mailDialog: MailDraftDialog,
      onOpenSource: (key) => void useNavigationStore.getState().openDocument(key),
      onSaveNote: (text) =>
        openDialog(
          'note',
          currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId),
          prefillNoteText(activeDocKey, text),
        ),
    }),
    [projectId, referenceSource, activeDocKey, rootId],
  );

  const draftSource = useMemo<NoteDraftSource>(
    () => ({
      useDraft: (entryId) => useNoteDrafts((state) => state.drafts[entryId]),
      acquire: (key, force) => useNoteDrafts.getState().acquire(key, force),
      release: (key) => useNoteDrafts.getState().release(key),
      edit: (key, text) => useNoteDrafts.getState().edit(key, text),
      save: (key) => useNoteDrafts.getState().save(key),
      saveAsNewNote: (entryId, text) =>
        openDialog(
          'note',
          currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId),
          prefillNoteText(entryId, text),
        ),
    }),
    [activeDocKey, rootId],
  );

  const loader = useMemo<ContentLoader>(() => {
    /** 文档读取路径与旧 ProjectDocument/SourceDetail 一致：source: → canvas/水源，条目 → workspace。 */
    const loadDocument = async (tabKey: TabId, force?: boolean): Promise<LoadedDocument> => {
      void force;
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
          void window.dela?.canvas.openLink(url).catch(useWorkspaceStore.getState().setError);
        } catch {
          useWorkspaceStore.getState().setError('不支持的链接');
        }
      },
      openShuiyuanTopic: (topicId, postNumber) =>
        useNavigationStore.getState().openShuiyuanTopic(topicId, postNumber),
      onExported: () => {
        // 导出会在我的资料里新增「预览导出」条目，目录树需一并刷新。
        void useWorkspaceStore.getState().refresh().catch(useWorkspaceStore.getState().setError);
      },
    };
  }, []);

  if (!loaded && workspaceError === null && window.dela)
    // 工作区镜像载入前不渲染：布局种子与标题解析都依赖条目树（旧 ProjectView 的
    // workspaceLoaded 种子门控）。
    return <div className="min-h-0 flex-1 bg-background" />;

  return (
    <ChatTabSourceProvider source={chatSource}>
      <NoteDraftSourceProvider source={draftSource}>
        <ContentLoaderProvider loader={loader}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {workspaceError && (
              <p className="px-4 py-2 text-sm text-destructive" role="alert">
                {workspaceError}
              </p>
            )}
            <div className="relative flex min-h-0 flex-1">
              <WorkbenchExplorer
                activeDocKey={activeDocKey}
                onAction={openDialog}
                onOpenDocument={(key) => void useNavigationStore.getState().openDocument(key)}
                onOpenToSide={(key) => {
                  // 「在另一栏打开」：先在当前组激活标签再分屏（新组复制活动标签，TabBar.splitTo 同款）。
                  const tabId = documentTabId(key);
                  const store = useWorkbenchLayout.getState();
                  store.openTab(tabId, store.focus);
                  store.splitGroup(store.focus, 'vertical');
                }}
                projectId={projectId}
              />
              <Workbench legacy={legacy} projectId={projectId} />
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
