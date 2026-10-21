// 视图路由 store：视图、back/forward 栈、当前工作台项目与一次性定位脉冲；
// projectId 为 null 表示通用（无项目）工作台。
import { create } from 'zustand';
import { leaveComposer } from '../features/mail/compose-close';
import { useShuiyuan } from '../features/shuiyuan/store';
import { ancestorChainOf } from './store';
import type { SettingsSectionId } from '../../shared/api';
import type { TabId } from '../../shared/layout';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { opensInEditor } from '../../shared/files';
import { useSessions } from '../sessions/store';
import { showToast } from '../app/toasts';

export type AppView =
  | 'home'
  | 'workbench'
  | 'mail'
  | 'timetable'
  | 'classroom'
  | 'shuiyuan'
  | 'todo'
  | 'notifications'
  | 'settings';

/** 窄屏抽屉层级：null 关闭；nav 主导航；mail 邮箱功能层（仅邮箱视图可达）。 */
export type MobileDrawer = 'nav' | 'mail';

const projectStorageKey = 'dela.workspace.project';

/** 一次性定位脉冲：每次赋新对象（seq 保证同目标也能再次触发），由工作台装配层消费。 */
export interface RevealPulse {
  tabId: TabId;
  /** 打开后直接保留（不作预览）：双击文件等「我要留着它」的打开。 */
  keep?: boolean;
  seq: number;
}

/** 首页聊天请求：sessionId 打开指定历史；否则创建或复用空会话。 */
export interface GeneralChatPulse {
  create: boolean;
  sessionId?: string;
  seq: number;
}

interface NavigationState {
  view: AppView;
  /** 当前工作台项目；null = 通用池。 */
  projectId: string | null;
  backStack: NavigationRoute[];
  forwardStack: NavigationRoute[];
  mailRequest: { messageId: number } | null;
  todoRequest: { id: string } | null;
  /** 每次赋新对象，保证已在设置页时也能触发分区切换。 */
  settingsRequest: { section: SettingsSectionId } | null;
  /** 新建项目弹窗脉冲（导航栏/托盘/快捷键），由工作台装配层转成 EntryDialogs 请求。 */
  createProject: boolean;
  /** 工作台标签定位脉冲（chat/note/preview 深链）。 */
  reveal: RevealPulse | null;
  generalChat: GeneralChatPulse | null;
  /** 首页上次停留的会话：切走再回首页接着上次，只活在本次运行内（重启后首页回到新对话）。 */
  lastHomeSessionId: string | null;
  navigate(next: AppView): boolean;
  goBack(): boolean;
  goForward(): boolean;
  /** 打开项目工作台；id 为空串/null 切到通用池。 */
  openProject(id: string): boolean;
  /** 通用聊天入口（导航「通用聊天」/托盘「新建对话」）。 */
  openGeneralChat(create: boolean): boolean;
  newChat(projectId: string | null): Promise<string | null>;
  /** 项目会话定位到项目工作台；随聊会话在资料工作台里就地开标签，否则回首页聊天。 */
  openChat(sessionId: string, projectId: string | null): boolean;
  rememberHomeSession(sessionId: string): void;
  /** 打开笔记标签，自动归属其所在项目。 */
  openNote(entryId: string): boolean;
  /** 打开文档（entryId 或 source: 资料键）为工作台标签，留在当前工作台；keep 时不作预览。 */
  openDocument(key: string, options?: { keep?: boolean }): boolean;
  openTerminal(projectId: string): boolean;
  openMail(messageId: number): boolean;
  openTodo(id: string): boolean;
  openSettings(section?: SettingsSectionId): boolean;
  openShuiyuanTopic(topicId: number, postNumber?: number): void;
  /** 新建项目弹窗（先回到工作台）。 */
  newProject(): boolean;
  setCreateProject(value: boolean): void;
  consumeReveal(): void;
  consumeGeneralChat(): void;
}

/** 历史条目：视图 + 项目（后退要能回到同一个项目面板）。 */
interface NavigationRoute {
  view: AppView;
  projectId: string | null;
}

let pulseSeq = 0;

function routeOf(state: NavigationState): NavigationRoute {
  return { view: state.view, projectId: state.projectId };
}

/** 记住当前项目：设置页「重置当前项目布局」读取此键。 */
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

/** 文档键（entryId 或 source:{sourceId}）→ TabId；本地文本文件开编辑标签，专用格式与资料走预览。 */
export function documentTabId(key: string): TabId {
  if (key.startsWith('source:')) return `preview:${key}`;
  const entry = useWorkspaceStore.getState().workspace.entries.find((e) => e.id === key);
  return entry?.kind === 'file' && opensInEditor(entry.name) ? `note:${key}` : `preview:${key}`;
}

/** 会话所属项目的推导：旧 scope 身份（home/sources/projects）与未知项目一律落通用池。 */
export function projectIdFromLegacyScope(scope: string): string | null {
  if (['home', 'sources', 'projects'].includes(scope)) return null;
  const entry = useWorkspaceStore
    .getState()
    .workspace.entries.find((e) => e.id === scope && e.kind === 'project');
  return entry?.id ?? null;
}

export const useNavigationStore = create<NavigationState>((set, get) => {
  /** 在指定项目的工作台里定位标签；换项目时清掉旧脉冲（旧 App.openProject 语义）。 */
  const revealInProject = (tabId: TabId, projectId: string | null, keep = false): boolean => {
    if (projectId !== get().projectId) {
      if (!get().openProject(projectId ?? '')) return false;
    } else if (!get().navigate('workbench')) return false;
    set({ reveal: { tabId, keep, seq: ++pulseSeq } });
    return true;
  };
  return {
    view: 'home',
    projectId: null,
    backStack: [],
    forwardStack: [],
    mailRequest: null,
    todoRequest: null,
    settingsRequest: null,
    createProject: false,
    reveal: null,
    generalChat: null,
    lastHomeSessionId: null,

    navigate: (next) => {
      const state = get();
      if (next === state.view) return true;
      if (!leaveComposer(() => get().navigate(next))) return false;
      set({
        view: next,
        ...(next === 'home' ? { projectId: null } : {}),
        backStack: [...state.backStack, routeOf(state)],
        forwardStack: [],
        mailRequest: null,
        todoRequest: null,
        settingsRequest: null,
        reveal: null,
        generalChat: null,
      });
      return true;
    },

    goBack: () => {
      const state = get();
      const prev = state.backStack[state.backStack.length - 1];
      if (prev === undefined || !leaveComposer(() => get().goBack())) return false;
      rememberProject(prev.projectId);
      set({
        view: prev.view,
        projectId: prev.projectId,
        backStack: state.backStack.slice(0, -1),
        forwardStack: [routeOf(state), ...state.forwardStack],
        mailRequest: null,
        todoRequest: null,
        settingsRequest: null,
        reveal: null,
        generalChat: null,
      });
      return true;
    },

    goForward: () => {
      const state = get();
      const next = state.forwardStack[0];
      if (next === undefined || !leaveComposer(() => get().goForward())) return false;
      rememberProject(next.projectId);
      set({
        view: next.view,
        projectId: next.projectId,
        backStack: [...state.backStack, routeOf(state)],
        forwardStack: state.forwardStack.slice(1),
        mailRequest: null,
        todoRequest: null,
        settingsRequest: null,
        reveal: null,
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
      set({ reveal: null, generalChat: null });
      return true;
    },

    openGeneralChat: (create) => {
      if (!get().navigate('home')) return false;
      set({ projectId: null, generalChat: { create, seq: ++pulseSeq } });
      return true;
    },

    newChat: async (projectId) => {
      // 落点跟着发起处走：首页发起的随聊留在首页，工作台里发起的（项目或资料）就地开在焦点组，
      // 不跳页、不分屏。main 对同一池复用未发送的空会话，所以连续新建不会堆出空标签。
      const onHome = projectId === null && get().view !== 'workbench';
      if (!window.dela || !get().navigate(onHome ? 'home' : 'workbench')) return null;
      try {
        // 通用会话的工作目录跟着落位走：首页随聊用私有目录，资料页用资料树里的课程目录。
        const chat = await window.dela.session.create(projectId, onHome ? 'chat' : 'library');
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
        showToast({ variant: 'error', title: '新建会话失败', description: errorText(cause) });
        return null;
      }
    },

    openChat: (sessionId, projectId) => {
      // 已在通用（资料）工作台里打开随聊历史：就地开标签，不跳回首页。
      if (projectId === null && get().view === 'workbench' && get().projectId === null)
        return revealInProject(`chat:${sessionId}`, null);
      if (projectId !== null) return revealInProject(`chat:${sessionId}`, projectId);
      if (!get().navigate('home')) return false;
      set({
        projectId: null,
        reveal: null,
        generalChat: { create: false, sessionId, seq: ++pulseSeq },
      });
      return true;
    },

    openNote: (entryId) => {
      const entries = useWorkspaceStore.getState().workspace.entries;
      // 最近的项目祖先决定归属；无项目祖先（顶层笔记/孤儿）落通用池。
      const project = ancestorChainOf(entries, entryId)
        .slice(0, -1)
        .reverse()
        .find((id) => entries.find((e) => e.id === id)?.kind === 'project');
      return revealInProject(`note:${entryId}`, project ?? null);
    },

    openDocument: (key, options) =>
      revealInProject(documentTabId(key), get().projectId, options?.keep),
    openTerminal: (projectId) => revealInProject(`terminal:${projectId}`, projectId),

    openMail: (messageId) => {
      if (!get().navigate('mail')) return false;
      set({ mailRequest: { messageId } });
      return true;
    },

    openTodo: (id) => {
      if (!get().navigate('todo')) return false;
      set({ todoRequest: { id } });
      return true;
    },

    openSettings: (section) => {
      if (!get().navigate('settings')) return false;
      set({ settingsRequest: section ? { section } : null });
      return true;
    },

    openShuiyuanTopic: (topicId, postNumber) => {
      get().navigate('shuiyuan');
      useShuiyuan.getState().requestTopic(topicId, postNumber);
    },

    newProject: () => {
      if (!get().navigate('workbench')) return false;
      set({ createProject: true });
      return true;
    },

    setCreateProject: (value) => set({ createProject: value }),
    consumeReveal: () => set({ reveal: null }),
    consumeGeneralChat: () => set({ generalChat: null }),
    rememberHomeSession: (sessionId) => set({ lastHomeSessionId: sessionId }),
  };
});
