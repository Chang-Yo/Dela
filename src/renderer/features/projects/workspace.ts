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
  release: (key: string) => void;
  edit: (key: string, text: string) => void;
  save: (key: string) => Promise<void>;
};

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(error);
const loading = new Map<string, Promise<void>>();
const scheduledSaves = new Map<string, ReturnType<typeof setTimeout>>();

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
  release: (key) => {
    const draft = get().drafts[key];
    if (!draft || draft.saving || draft.text !== draft.saved || draft.content.format === 'markdown')
      return;
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    });
  },
  edit: (key, text) => {
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
  save: async (key) => {
    const draft = get().drafts[key];
    if (
      !window.dela ||
      !draft ||
      draft.saving ||
      draft.text === draft.saved ||
      !draft.content.revision
    )
      return;
    const text = draft.text;
    set((s) => ({ drafts: { ...s.drafts, [key]: { ...draft, saving: true } } }));
    try {
      const revision = await window.dela.workspace.saveNote(key, text, draft.content.revision);
      set((s) => ({
        drafts: {
          ...s.drafts,
          [key]: {
            ...s.drafts[key]!,
            saved: text,
            content: { ...s.drafts[key]!.content, revision },
            saving: false,
            error: null,
          },
        },
      }));
    } catch (error) {
      set((s) => ({
        drafts: {
          ...s.drafts,
          [key]: { ...s.drafts[key]!, saving: false, error: errorText(error) },
        },
      }));
    }
    const current = get().drafts[key];
    if (current && !current.error && current.text !== current.saved) void get().save(key);
  },
}));
