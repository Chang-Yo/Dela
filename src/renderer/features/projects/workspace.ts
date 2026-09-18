import { create } from 'zustand';
import type {
  CanvasState,
  DocumentContent,
  WorkspaceState,
  WorkspaceViewState,
} from '../../../shared/api';

export const emptyView: WorkspaceViewState = { tabs: [], active: null, expanded: [], scroll: {} };
export type Draft = {
  content: DocumentContent;
  text: string;
  saved: string;
  saving: boolean;
  error: string | null;
};

type Store = {
  workspace: WorkspaceState;
  canvas: CanvasState;
  loaded: boolean;
  error: string | null;
  drafts: Record<string, Draft>;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setCanvas: (state: CanvasState) => void;
  setView: (scope: string, state: WorkspaceViewState) => void;
  setError: (error: unknown) => void;
  read: (key: string, force?: boolean) => Promise<void>;
  /** Flush a draft before releasing it. False means it is still present and dirty. */
  release: (key: string) => Promise<boolean>;
  edit: (key: string, text: string) => void;
  /** Resolves true only when the current draft is clean (or was already clean). */
  save: (key: string) => Promise<boolean>;
};

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(error);
const loading = new Map<string, Promise<void>>();
const scheduledSaves = new Map<string, ReturnType<typeof setTimeout>>();
const saving = new Map<string, Promise<boolean>>();

export const useWorkspace = create<Store>((set, get) => ({
  workspace: { entries: [], views: {}, directory: '' },
  canvas: { connected: false, syncedAt: null, courses: [], items: [] },
  loaded: false,
  error: null,
  drafts: {},
  setError: (error) => set({ error: error === null ? null : errorText(error) }),
  load: async () => {
    if (get().loaded || !window.dela) return;
    const [workspace, canvas] = await Promise.allSettled([
      window.dela.workspace.getState(),
      window.dela.canvas.getState(),
    ]);
    if (workspace.status === 'fulfilled') set({ workspace: workspace.value, loaded: true });
    else set({ error: errorText(workspace.reason) });
    if (canvas.status === 'fulfilled') set({ canvas: canvas.value });
    else set({ error: errorText(canvas.reason) });
  },
  refresh: async () => {
    if (window.dela) set({ workspace: await window.dela.workspace.getState() });
  },
  setCanvas: (canvas) => set({ canvas }),
  setView: (scope, state) => {
    set((s) => ({
      workspace: { ...s.workspace, views: { ...s.workspace.views, [scope]: state } },
    }));
    void window.dela?.workspace.saveView(scope, state).catch(get().setError);
  },
  read: async (key, force = false) => {
    if (!window.dela || (!force && get().drafts[key])) return;
    if (force && get().drafts[key]?.saving) {
      const pending = saving.get(key);
      if (!pending || !(await pending)) return;
    }
    const pending = loading.get(key);
    if (pending) return pending;
    const started = get().drafts[key];
    const work = (async () => {
      const api = window.dela!;
      const sourceId = key.startsWith('source:') ? key.slice(7) : null;
      const content = sourceId
        ? sourceId.startsWith('shuiyuan-topic:')
          ? await api.shuiyuan.readSource(Number(sourceId.slice('shuiyuan-topic:'.length)))
          : await api.canvas.read(sourceId)
        : await api.workspace.read(key);
      const current = get().drafts[key];
      // A refresh must never replace edits made while it was reading. A confirmed
      // reload may discard the snapshot that existed when it started, but a newer
      // edit always wins.
      if (
        started &&
        current &&
        (current.text !== started.text ||
          current.content.revision !== started.content.revision ||
          current.saving)
      )
        return;
      set((s) => ({
        drafts: {
          ...s.drafts,
          [key]: {
            content,
            text: content.text ?? '',
            saved: content.text ?? '',
            saving: false,
            error: null,
          },
        },
      }));
    })().finally(() => loading.delete(key));
    loading.set(key, work);
    return work;
  },
  release: async (key) => {
    const timer = scheduledSaves.get(key);
    if (timer) {
      clearTimeout(timer);
      scheduledSaves.delete(key);
    }
    const draft = get().drafts[key];
    if (!draft) return true;
    if (draft.saving || draft.text !== draft.saved) {
      if (!(await get().save(key))) return false;
    }
    const current = get().drafts[key];
    if (!current || current.saving || current.text !== current.saved) return false;
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    });
    return true;
  },
  edit: (key, text) => {
    if (!get().drafts[key]) return;
    set((s) => ({ drafts: { ...s.drafts, [key]: { ...s.drafts[key]!, text, error: null } } }));
    clearTimeout(scheduledSaves.get(key));
    scheduledSaves.set(
      key,
      setTimeout(() => {
        scheduledSaves.delete(key);
        void get().save(key);
      }, 600),
    );
  },
  save: (key) => {
    const existing = saving.get(key);
    if (existing) return existing;
    const timer = scheduledSaves.get(key);
    if (timer) {
      clearTimeout(timer);
      scheduledSaves.delete(key);
    }
    const task = (async (): Promise<boolean> => {
      while (true) {
        const draft = get().drafts[key];
        if (!draft) return true;
        if (draft.text === draft.saved) return true;
        if (!window.dela) return false;
        if (!draft.content.revision) {
          const message = '此文档没有可用的保存版本。';
          set((s) => ({
            drafts: s.drafts[key]
              ? { ...s.drafts, [key]: { ...s.drafts[key]!, saving: false, error: message } }
              : s.drafts,
          }));
          return false;
        }
        const text = draft.text;
        set((s) => ({
          drafts: s.drafts[key]
            ? { ...s.drafts, [key]: { ...s.drafts[key]!, saving: true } }
            : s.drafts,
        }));
        try {
          const revision = await window.dela.workspace.saveNote(key, text, draft.content.revision);
          set((s) => {
            const current = s.drafts[key];
            if (!current) return s;
            return {
              drafts: {
                ...s.drafts,
                [key]: {
                  ...current,
                  saved: text,
                  content: { ...current.content, revision },
                  saving: false,
                  error: null,
                },
              },
            };
          });
        } catch (error) {
          set((s) => ({
            drafts: s.drafts[key]
              ? {
                  ...s.drafts,
                  [key]: { ...s.drafts[key]!, saving: false, error: errorText(error) },
                }
              : s.drafts,
          }));
          return false;
        }
      }
    })();
    saving.set(key, task);
    void task.then(
      () => {
        if (saving.get(key) === task) saving.delete(key);
      },
      () => {
        if (saving.get(key) === task) saving.delete(key);
      },
    );
    return task;
  },
}));
