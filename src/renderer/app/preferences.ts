// 只有界面用、主进程不读的偏好：一个持久化 store，写入只发生在 action 里。
import { useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { z } from 'zod';

export type ProjectNavPreference = { pinned?: boolean; section?: string };

const defaults = {
  shellSidebarCollapsed: false,
  projectOpenTarget: 'vscode' as 'vscode' | 'explorer',
  mailFoldersCollapsed: true,
  todoShowCompleted: true,
  classroomSidebarWidth: 300,
  classroomSidebarCollapsed: false,
  workspaceSidebarWidth: 300,
  workspaceSidebarCollapsed: false,
  hiddenNavEntries: [] as string[],
  projectNav: {} as Record<string, ProjectNavPreference>,
  remoteLastDirectory: {} as Record<string, string>,
};

type PreferenceValues = typeof defaults;

type PreferencesStore = PreferenceValues & {
  setPreference: <K extends keyof PreferenceValues>(key: K, value: PreferenceValues[K]) => void;
  setNavEntryVisible: (id: string, visible: boolean) => void;
  patchProjectNav: (id: string, patch: ProjectNavPreference) => void;
};

const storageKey = 'dela.preferences';
const classroomWidthRange = { min: 240, max: 360 };

const legacyNavEntries = z.object({ state: z.object({ hidden: z.array(z.string()) }) });
const legacyProjectNav = z.object({
  state: z.object({
    projects: z.record(
      z.string(),
      z.object({ pinned: z.boolean().optional(), section: z.string().optional() }),
    ),
  }),
});
const legacyRemoteDirectories = z.record(z.string(), z.string());

function readLegacyJson<T>(key: string, schema: z.ZodType<T>): T | undefined {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function legacyWidth(key: string, accept: (value: number) => boolean, fallback: number): number {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && accept(stored) ? stored : fallback;
}

const legacyKeys = [
  'dela.shell.sidebar-collapsed',
  'dela.project.open-target',
  'dela.mail.folders-collapsed',
  'dela.todo.show-completed',
  'dela.classroom.sidebarWidth',
  'dela.classroom.sidebarCollapsed',
  'dela.workspace.sidebarWidth',
  'dela.workspace.collapsed',
  'dela.nav-entries',
  'dela.project-nav',
  'dela.remote.lastDirectory',
];

/** 升级后第一次启动：把分散的旧键并成新值，写入新键后删除旧键。 */
function migrateLegacyPreferences(): string {
  const state: PreferenceValues = {
    shellSidebarCollapsed: localStorage.getItem('dela.shell.sidebar-collapsed') === 'true',
    projectOpenTarget:
      localStorage.getItem('dela.project.open-target') === 'explorer' ? 'explorer' : 'vscode',
    mailFoldersCollapsed: localStorage.getItem('dela.mail.folders-collapsed') !== 'false',
    todoShowCompleted: localStorage.getItem('dela.todo.show-completed') !== 'false',
    classroomSidebarWidth: legacyWidth(
      'dela.classroom.sidebarWidth',
      (value) => value >= classroomWidthRange.min && value <= classroomWidthRange.max,
      defaults.classroomSidebarWidth,
    ),
    classroomSidebarCollapsed: localStorage.getItem('dela.classroom.sidebarCollapsed') === '1',
    workspaceSidebarWidth: legacyWidth(
      'dela.workspace.sidebarWidth',
      (value) => value > 0,
      defaults.workspaceSidebarWidth,
    ),
    workspaceSidebarCollapsed: localStorage.getItem('dela.workspace.collapsed') === 'true',
    hiddenNavEntries:
      readLegacyJson('dela.nav-entries', legacyNavEntries)?.state.hidden ??
      defaults.hiddenNavEntries,
    projectNav:
      readLegacyJson('dela.project-nav', legacyProjectNav)?.state.projects ?? defaults.projectNav,
    remoteLastDirectory:
      readLegacyJson('dela.remote.lastDirectory', legacyRemoteDirectories) ??
      defaults.remoteLastDirectory,
  };
  const serialized = JSON.stringify({ state, version: 1 });
  localStorage.setItem(storageKey, serialized);
  for (const key of legacyKeys) localStorage.removeItem(key);
  return serialized;
}

export const usePreferences = create<PreferencesStore>()(
  persist(
    (set) => ({
      ...defaults,
      setPreference: (key, value) => set({ [key]: value }),
      setNavEntryVisible: (id, visible) =>
        set((state) => ({
          hiddenNavEntries: visible
            ? state.hiddenNavEntries.filter((item) => item !== id)
            : [...new Set([...state.hiddenNavEntries, id])],
        })),
      patchProjectNav: (id, patch) =>
        set((state) => ({
          projectNav: { ...state.projectNav, [id]: { ...state.projectNav[id], ...patch } },
        })),
    }),
    {
      name: storageKey,
      version: 1,
      storage: createJSONStorage(() => ({
        getItem: (name) => localStorage.getItem(name) ?? migrateLegacyPreferences(),
        setItem: (name, value) => localStorage.setItem(name, value),
        removeItem: (name) => localStorage.removeItem(name),
      })),
    },
  ),
);

/** 侧栏宽度：拖动中只改本地值，拖动结束或键盘调整时才写入偏好。 */
export function usePreferenceWidth(key: 'classroomSidebarWidth' | 'workspaceSidebarWidth') {
  const stored = usePreferences((state) => state[key]);
  const setPreference = usePreferences((state) => state.setPreference);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  return {
    width: dragWidth ?? stored,
    resizing,
    onChange: (width: number) => (resizing ? setDragWidth(width) : setPreference(key, width)),
    onResizingChange: (next: boolean) => {
      setResizing(next);
      if (!next && dragWidth !== null) {
        setPreference(key, dragWidth);
        setDragWidth(null);
      }
    },
  };
}
