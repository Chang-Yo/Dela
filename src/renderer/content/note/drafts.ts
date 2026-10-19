// 笔记草稿生命周期 store：同一文档多入口共享正文与版本，防抖与互斥语义是这份共享的关键。
// acquire/release 以引用计数持有，最后一个引用释放时才冲盘并移除。
import { create } from 'zustand';
import type { DocumentContent } from '../../../shared/api';
import { errorText } from '../../workspace/store';
import { relocateWorkspacePath } from '../../../shared/workspace';

export type NoteDraft = {
  content: DocumentContent;
  text: string;
  saved: string;
  saving: boolean;
  error: string | null;
};

type Store = {
  drafts: Record<string, NoteDraft>;
  /** 读取（或复用）一份草稿；force 时先等在途保存结束再重读，不新增引用计数。 */
  acquire: (key: string, force?: boolean) => Promise<void>;
  /** Flush a draft before releasing it. False means it is still present and dirty. */
  release: (key: string) => Promise<boolean>;
  edit: (key: string, text: string) => void;
  /** Resolves true only when the current draft is clean (or was already clean). */
  save: (key: string) => Promise<boolean>;
  relocatePaths: (from: string, to: string) => void;
};

const loading = new Map<string, Promise<void>>();
const scheduledSaves = new Map<string, ReturnType<typeof setTimeout>>();
const saving = new Map<string, Promise<boolean>>();
/** 每个 key 的持有入口数；最后一个引用释放时才冲盘移除。 */
const refcounts = new Map<string, number>();

export const useNoteDrafts = create<Store>((set, get) => ({
  drafts: {},
  relocatePaths: (from, to) => {
    const drafts: Record<string, NoteDraft> = {};
    for (const [key, draft] of Object.entries(get().drafts)) {
      const next = relocateWorkspacePath(key, from, to);
      drafts[next] =
        next === key
          ? draft
          : {
              ...draft,
              content: {
                ...draft.content,
                title: next.split(next.startsWith('/') ? '/' : /[\\/]/).at(-1)!,
              },
            };
    }
    set({ drafts });
  },
  acquire: async (key, force = false) => {
    // force 语义是「强制重读磁盘」而非新持有入口（NoteTab 窗口聚焦刷新、App 会话终态
    // 刷新都复用它且无配对 release）：不计数，否则草稿被永久持有、重开时复用过期快照。
    if (!force) refcounts.set(key, (refcounts.get(key) ?? 0) + 1);
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
    const refs = refcounts.get(key) ?? 0;
    // 其他入口仍持有同一草稿：不冲盘不移除。
    if (refs > 1) {
      refcounts.set(key, refs - 1);
      return true;
    }
    refcounts.delete(key);
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
    // 冲盘 await 期间可能被重新 acquire（切走又切回）：新持有入口在场时只冲盘不删除，
    // 否则新入口拿不到草稿会永久停在「正在打开…」。
    if (refcounts.has(key)) return true;
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
