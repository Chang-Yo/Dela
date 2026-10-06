// 视图路由 zustand store（docs/refactor/structure.md §3.1）：view、back/forward 栈、
// 当前工作台项目与一次性定位请求脉冲（旧 App.tsx 的 chatRequest/mailRequest/todoRequest/
// settingsRequest/createProject 五类脉冲迁到这里）。'workbench' 统一取代旧 home/project/
// sources 三视图；projectId 为 null 表示通用（无项目）工作台。
import { create } from 'zustand';
import { leaveComposer } from '../features/mail/compose-close';
import { useShuiyuan } from '../features/shuiyuan/store';
import { ancestorChainOf } from '../navigation/store';
import type { SettingsSectionId } from '../../shared/api';
import type { TabId } from '../../shared/layout';
import { useWorkspaceStore } from '../workspace/store';
import { useSessions } from '../sessions/store';
import { errorText } from '../workspace/store';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { walkGroups } from '../workbench/layout-schema';

export type AppView =
  'home' | 'workbench' | 'mail' | 'timetable' | 'shuiyuan' | 'todo' | 'notifications' | 'settings';

/** 窄屏抽屉层级：null 关闭；nav 主导航；mail 邮箱功能层（仅邮箱视图可达）。 */
export type MobileDrawer = 'nav' | 'mail';

const projectStorageKey = 'dela.workspace.project';

/** 一次性定位脉冲：每次赋新对象（seq 保证同目标也能再次触发），由工作台装配层消费。 */
export interface RevealPulse {
  tabId: TabId;
  seq: number;
}

/** 通用聊天入口脉冲：create=true 新建会话；否则定位已有的通用会话标签。 */
export interface GeneralChatPulse {
  create: boolean;
  seq: number;
}

interface NavigationState {
  view: AppView;
  /** 当前工作台项目；null = 通用池。 */
  projectId: string | null;
  backStack: AppView[];
  forwardStack: AppView[];
  navigationError: string | null;
  mailRequest: { messageId: number } | null;
  todoRequest: { id: string } | null;
  /** 每次赋新对象，保证已在设置页时也能触发分区切换。 */
  settingsRequest: { section: SettingsSectionId } | null;
  /** 新建项目弹窗脉冲（导航栏/托盘/快捷键），由工作台装配层转成 EntryDialogs 请求。 */
  createProject: boolean;
  /** 工作台标签定位脉冲（chat/note/preview 深链）。 */
  reveal: RevealPulse | null;
  generalChat: GeneralChatPulse | null;
  navigate(next: AppView): boolean;
  goBack(): boolean;
  goForward(): boolean;
  /** 打开项目工作台；id 为空串/null 切到通用池。 */
  openProject(id: string): boolean;
  /** 通用聊天入口（导航「通用聊天」/托盘「新建对话」）。 */
  openGeneralChat(create: boolean): boolean;
  newChat(projectId: string | null): Promise<string | null>;
  /** 打开会话标签；projectId 决定工作台池。 */
  openChat(sessionId: string, projectId: string | null): boolean;
  /** 打开笔记标签，自动归属其所在项目。 */
  openNote(entryId: string): boolean;
  /** 打开文档（entryId 或 source: 资料键）为工作台标签，留在当前工作台。 */
  openDocument(key: string): boolean;
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
  setNavigationError(error: string | null): void;
}

let pulseSeq = 0;

/** 文档键（entryId 或 source:{sourceId}）→ TabId；笔记条目开 note 标签，其余只读预览。 */
export function documentTabId(key: string): TabId {
  if (key.startsWith('source:')) return `preview:${key}`;
  const kind = useWorkspaceStore.getState().workspace.entries.find((e) => e.id === key)?.kind;
  return kind === 'note' ? `note:${key}` : `preview:${key}`;
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
  const revealInProject = (tabId: TabId, projectId: string | null): boolean => {
    if (projectId !== get().projectId) {
      if (!get().openProject(projectId ?? '')) return false;
    } else if (!get().navigate('workbench')) return false;
    set({ reveal: { tabId, seq: ++pulseSeq } });
    return true;
  };
  return {
    view: 'home',
    projectId: null,
    backStack: [],
    forwardStack: [],
    navigationError: null,
    mailRequest: null,
    todoRequest: null,
    settingsRequest: null,
    createProject: false,
    reveal: null,
    generalChat: null,

    navigate: (next) => {
      const state = get();
      if (next === state.view) return true;
      if (!leaveComposer(() => get().navigate(next))) return false;
      set({
        view: next,
        ...(next === 'home' ? { projectId: null } : {}),
        backStack: [...state.backStack, state.view],
        forwardStack: [],
        mailRequest: null,
        todoRequest: null,
        settingsRequest: null,
        reveal: null,
        generalChat: null,
        navigationError: null,
      });
      return true;
    },

    goBack: () => {
      const state = get();
      const prev = state.backStack[state.backStack.length - 1];
      if (prev === undefined || !leaveComposer(() => get().goBack())) return false;
      set({
        view: prev,
        backStack: state.backStack.slice(0, -1),
        forwardStack: [state.view, ...state.forwardStack],
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
      set({
        view: next,
        backStack: [...state.backStack, state.view],
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
      if (!get().navigate('workbench')) return false;
      const next = id || null;
      if (get().projectId !== next) set({ projectId: next });
      try {
        localStorage.setItem(projectStorageKey, id);
      } catch {
        /* localStorage 可用性不影响导航。 */
      }
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
      if (!window.dela || !get().navigate('workbench')) return null;
      try {
        const chat = await window.dela.session.create(projectId);
        if (!chat.sessionId) throw new Error('会话创建失败');
        useSessions.getState().putChat(chat.sessionId, chat);
        // 兼容此前连续新建留下的空标签；仅关闭视图，不删除会话和输入草稿。
        const layout = useWorkbenchLayout.getState();
        if (layout.ready && layout.projectId === projectId) {
          const tabs = walkGroups(layout.root).flatMap((group) =>
            group.tabs
              .filter((tab) => tab.startsWith('chat:') && tab !== `chat:${chat.sessionId}`)
              .map((tab) => ({ tab, groupId: group.id })),
          );
          for (const { tab, groupId } of tabs) {
            const id = tab.slice('chat:'.length);
            const previous =
              useSessions.getState().chats[id] ??
              (await window.dela.session.open(id).catch(() => null));
            if (previous && previous.messages.length === 0 && !previous.running)
              useWorkbenchLayout.getState().closeTab(tab, groupId);
          }
        }
        void useSessions
          .getState()
          .refresh(projectId)
          .catch(() => {});
        get().openChat(chat.sessionId, projectId);
        return chat.sessionId;
      } catch (cause) {
        set({ navigationError: errorText(cause) });
        return null;
      }
    },

    openChat: (sessionId, projectId) => revealInProject(`chat:${sessionId}`, projectId),

    openNote: (entryId) => {
      const entries = useWorkspaceStore.getState().workspace.entries;
      // 最近的项目祖先决定归属；无项目祖先（顶层笔记/孤儿）落通用池。
      const project = ancestorChainOf(entries, entryId)
        .slice(0, -1)
        .reverse()
        .find((id) => entries.find((e) => e.id === id)?.kind === 'project');
      return revealInProject(`note:${entryId}`, project ?? null);
    },

    openDocument: (key) => revealInProject(documentTabId(key), get().projectId),
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
    setNavigationError: (error) => set({ navigationError: error }),
  };
});
