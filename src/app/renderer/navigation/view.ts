// 视图路由 store：视图、back/forward 栈、当前工作台项目与一次性请求脉冲；
// projectId 为 null 表示通用（无项目）工作台。
import { create } from 'zustand';
import { agentClient, type HomeChatRequest, useSessions } from '../../../modules/chat/view';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { useEntryDialog } from '../workspace/entry-dialog-store';
import { useMobileDrawer } from '../shell/mobile-drawer';
import type { SettingsSectionId } from '../../../modules/settings/contract';
import type { TabId } from '../../../modules/workspace/contract';
import { useWorkspaceStore } from '../../../modules/workspace/view';
import { formatByName, opensInEditor } from '../../../core/protocol/files';
import { parseRemoteNodeId } from '../../../modules/remotes/contract';
import { showToast } from '../../../ui/toast';
import type { NavTarget, NavTargets } from '../../module';
import { pages, views } from '../../views';
import { errorMessage } from '../../../core/protocol/contract';

export type ShellView = 'home' | 'workbench' | 'settings';

type ShellTarget = 'projects' | 'chat' | 'sources' | 'settings';

export type AppView = ShellView | Exclude<keyof NavTargets, ShellTarget>;

const projectStorageKey = 'dela.workspace.project';

interface NavigationState {
  view: AppView;
  target: NavTarget | null;
  projectId: string | null;
  backStack: NavigationRoute[];
  forwardStack: NavigationRoute[];
  settingsSection: SettingsSectionId;
  generalChat: HomeChatRequest | null;
  homeSeq: number;
  navigate(next: ShellView | NavTarget): boolean;
  goBack(): boolean;
  goForward(): boolean;
  openProject(id: string): boolean;
  openGeneralChat(create: boolean): boolean;
  newChat(projectId: string | null): Promise<string | null>;
  openChat(sessionId: string, projectId: string | null): boolean;
  openDocument(key: string, options?: { keep?: boolean }): boolean;
  openTerminal(projectId: string): boolean;
  openSettings(section?: SettingsSectionId): boolean;
  newProject(): boolean;
}

interface NavigationRoute {
  view: AppView;
  target: NavTarget | null;
  projectId: string | null;
}

const leaveViews = (proceed: () => void) =>
  views.every((view) => view.leaveGuard?.(proceed) ?? true);

function routeOf(state: NavigationState): NavigationRoute {
  return { view: state.view, target: state.target, projectId: state.projectId };
}

function rememberProject(id: string | null): void {
  try {
    localStorage.setItem(projectStorageKey, id ?? '');
  } catch {
    /* localStorage 可用性不影响导航。 */
  }
}

function currentProjectLive(): boolean {
  const { projectId } = useNavigationStore.getState();
  return (
    projectId === null ||
    useWorkspaceStore.getState().workspace.entries.some((entry) => entry.id === projectId)
  );
}

/** 本地文本文件开编辑标签，远端 Markdown 开只读的编辑标签，专用格式与资料走预览。 */
export function documentTabId(key: string): TabId {
  if (key.startsWith('source:')) return `preview:${key}`;
  const remote = parseRemoteNodeId(key);
  if (remote) return formatByName(remote.path) === 'markdown' ? `note:${key}` : `preview:${key}`;
  const entry = useWorkspaceStore.getState().workspace.entries.find((e) => e.id === key);
  return (entry?.kind === 'file' || (!entry && /^(?:[a-z]:[\\/]|\/)/i.test(key))) &&
    opensInEditor(entry?.name ?? key)
    ? `note:${key}`
    : `preview:${key}`;
}

export const useNavigationStore = create<NavigationState>((set, get) => {
  const revealInProject = (tabId: TabId, projectId: string | null, keep = false): boolean => {
    if (projectId !== get().projectId) {
      if (!get().openProject(projectId ?? '')) return false;
    } else if (!get().navigate('workbench')) return false;
    useWorkbenchLayout.getState().reveal(tabId, projectId, keep);
    return true;
  };
  return {
    view: 'home',
    target: null,
    projectId: null,
    backStack: [],
    forwardStack: [],
    settingsSection: 'general',
    generalChat: null,
    homeSeq: 0,

    navigate: (next) => {
      if (typeof next !== 'string') {
        if (next.page === 'projects') return get().openProject(next.entryId);
        if (next.page === 'chat') {
          if (next.sessionId) return get().openChat(next.sessionId, next.projectId);
          if (next.projectId === null && get().view === 'home') return get().openGeneralChat(true);
          void get().newChat(next.projectId);
          return true;
        }
        if (next.page === 'sources') return get().openDocument(`source:${next.sourceId}`);
        if (next.page === 'settings') return get().openSettings(next.section);
      }
      const view = typeof next === 'string' ? next : next.page;
      const target = typeof next === 'string' ? null : next;
      const page = target && pages.of(target.page);
      if (target && !page) {
        showToast({ variant: 'error', title: '该功能在当前版本中未启用' });
        return false;
      }
      const state = get();
      // 同一页内再次跳转只换参数、不压栈，页面据新的 target 重置。
      if (!leaveViews(() => get().navigate(next))) return false;
      if (view === state.view) {
        if (target) set({ target });
      } else {
        useMobileDrawer.getState().setDrawer(null);
        set({
          view,
          target,
          ...(view === 'home' ? { projectId: null } : {}),
          backStack: [...state.backStack, routeOf(state)],
          forwardStack: [],
          settingsSection: 'general',
          generalChat: null,
        });
      }
      if (target) page?.open?.(target);
      return true;
    },

    goBack: () => {
      const state = get();
      const prev = state.backStack[state.backStack.length - 1];
      if (prev === undefined || !leaveViews(() => get().goBack())) return false;
      rememberProject(prev.projectId);
      useMobileDrawer.getState().setDrawer(null);
      set({
        view: prev.view,
        target: prev.target,
        projectId: prev.projectId,
        backStack: state.backStack.slice(0, -1),
        forwardStack: [routeOf(state), ...state.forwardStack],
        settingsSection: 'general',
        generalChat: null,
      });
      return true;
    },

    goForward: () => {
      const state = get();
      const next = state.forwardStack[0];
      if (next === undefined || !leaveViews(() => get().goForward())) return false;
      rememberProject(next.projectId);
      useMobileDrawer.getState().setDrawer(null);
      set({
        view: next.view,
        target: next.target,
        projectId: next.projectId,
        backStack: [...state.backStack, routeOf(state)],
        forwardStack: state.forwardStack.slice(1),
        settingsSection: 'general',
        generalChat: null,
      });
      return true;
    },

    openProject: (id) => {
      const next = id || null;
      const fromWorkbench = get().view === 'workbench';
      if (!get().navigate('workbench')) return false;
      if (get().projectId !== next) {
        // 同视图换项目时 navigate 因视图未变而早退、不压栈，这里补记来源，否则从项目面板切走
        // 就退不回来。来源项目已被删除（工作区自动回退通用池）时不记，避免后退跳回不存在的项目。
        if (fromWorkbench && currentProjectLive()) {
          set((state) => ({ backStack: [...state.backStack, routeOf(state)], forwardStack: [] }));
        }
        set({ projectId: next });
      }
      rememberProject(id);
      // navigate 在同视图切换时早退不清请求；换项目后旧会话指针不该再把用户拉回去。
      set({ generalChat: null });
      return true;
    },

    openGeneralChat: (create) => {
      if (!get().navigate('home')) return false;
      const seq = get().homeSeq + 1;
      set({ projectId: null, homeSeq: seq, generalChat: { create, seq } });
      return true;
    },

    newChat: async (projectId) => {
      // 落点跟着发起处走：首页发起的随聊留在首页，工作台里发起的（项目或资料）就地开在焦点组，
      // 不跳页、不分屏。main 对同一池复用未发送的空会话，所以连续新建不会堆出空标签。
      const onHome = projectId === null && get().view !== 'workbench';
      if (!window.dela || !get().navigate(onHome ? 'home' : 'workbench')) return null;
      try {
        const chat = await agentClient['create-session']({ projectId });
        if (!chat.sessionId) throw new Error('会话创建失败');
        useSessions.getState().putChat(chat.sessionId, chat);
        void useSessions
          .getState()
          .refresh(projectId)
          .catch(() => {});
        if (onHome) get().openChat(chat.sessionId, null);
        else revealInProject(`chat:${chat.sessionId}`, projectId);
        return chat.sessionId;
      } catch (cause) {
        showToast({ variant: 'error', title: '新建会话失败', description: errorMessage(cause) });
        return null;
      }
    },

    openChat: (sessionId, projectId) => {
      if (projectId === null && get().view === 'workbench' && get().projectId === null)
        return revealInProject(`chat:${sessionId}`, null);
      if (projectId !== null) return revealInProject(`chat:${sessionId}`, projectId);
      if (!get().navigate('home')) return false;
      const seq = get().homeSeq + 1;
      set({ projectId: null, homeSeq: seq, generalChat: { create: false, sessionId, seq } });
      return true;
    },

    openDocument: (key, options) =>
      revealInProject(documentTabId(key), get().projectId, options?.keep),
    openTerminal: (projectId) => revealInProject(`terminal:${projectId}`, projectId),

    openSettings: (section) => {
      if (!get().navigate('settings')) return false;
      if (section) set({ settingsSection: section });
      return true;
    },

    newProject: () => {
      if (!get().navigate('workbench')) return false;
      useEntryDialog.getState().open({ action: 'project', id: null });
      return true;
    },
  };
});
