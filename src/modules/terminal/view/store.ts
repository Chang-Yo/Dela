// 终端会话在渲染端的唯一副本：主进程推来的输出事件在这里累积成回放缓冲，标签只订阅标题与退出状态，
// 逐块输出不会刷新界面。事件订阅在 store 创建时建立一次。
import { create } from 'zustand';
import type { TerminalEvent, TerminalSession } from '../contract';
import { onTerminalEvent, terminalClient } from './client';

const BUFFER_LIMIT = 1024 * 1024;

type TerminalMeta = Pick<TerminalSession, 'id' | 'title' | 'exitCode'>;
type Output = Pick<TerminalSession, 'buffer' | 'sequence'>;

interface TerminalStore {
  /** 项目 id → 它的会话；输出不在这里，订阅标签的组件不会随输出重渲。 */
  tabs: Record<string, TerminalMeta[]>;
  /** 会话 id → 回放缓冲与已应用的最大序号。 */
  output: Record<string, Output>;
  /** 项目 id → 上次选中的会话：关掉标签再打开仍回到它。 */
  active: Record<string, string>;
  /** 读取清单或创建会话期间先到的事件：快照装入后按序号补上。 */
  pending: TerminalEvent[];
  /** 在途的读取（`list:<项目>`）与创建（会话 id），决定未知会话的事件要不要先留着。 */
  inFlight: string[];
  load: (projectId: string) => Promise<TerminalSession[]>;
  create: (projectId: string) => Promise<void>;
  close: (projectId: string, id: string) => Promise<void>;
  select: (projectId: string, id: string | null) => void;
}

function applyEvent(session: TerminalSession, event: TerminalEvent): TerminalSession {
  if (event.sequence <= session.sequence) return session;
  return event.type === 'data'
    ? {
        ...session,
        sequence: event.sequence,
        buffer: (session.buffer + event.data).slice(-BUFFER_LIMIT),
      }
    : { ...session, sequence: event.sequence, exitCode: event.exitCode };
}

const metaOf = ({ id, title, exitCode }: TerminalSession): TerminalMeta => ({
  id,
  title,
  exitCode,
});
const outputOf = ({ buffer, sequence }: TerminalSession): Output => ({ buffer, sequence });

export const useTerminalStore = create<TerminalStore>((set, get) => {
  const hold = (token: string) => set((state) => ({ inFlight: [...state.inFlight, token] }));
  const release = (token: string) =>
    set((state) => {
      const inFlight = state.inFlight.filter((item) => item !== token);
      return {
        inFlight,
        pending: state.pending.filter(
          (event) => inFlight.includes(`list:${event.projectId}`) || inFlight.includes(event.id),
        ),
      };
    });
  /** 把先到的事件补进快照，再按项目装入；`keep` 为真时保留项目里已有的会话。 */
  const install = (projectId: string, items: TerminalSession[], keep: boolean) =>
    set((state) => {
      const merged = items.map((item) =>
        state.pending.filter((event) => event.id === item.id).reduce(applyEvent, item),
      );
      const installed = new Set(items.map((item) => item.id));
      const kept = keep ? (state.tabs[projectId] ?? []) : [];
      const output = { ...state.output };
      if (!keep) for (const { id } of state.tabs[projectId] ?? []) delete output[id];
      for (const session of merged) output[session.id] = outputOf(session);
      return {
        tabs: { ...state.tabs, [projectId]: [...kept, ...merged.map(metaOf)] },
        output,
        pending: state.pending.filter((event) => !installed.has(event.id)),
      };
    });

  return {
    tabs: {},
    output: {},
    active: {},
    pending: [],
    inFlight: [],
    async load(projectId) {
      const token = `list:${projectId}`;
      hold(token);
      try {
        const items = await terminalClient.list(projectId);
        install(projectId, items, false);
        return items;
      } finally {
        release(token);
      }
    },
    async create(projectId) {
      const id = crypto.randomUUID();
      hold(id);
      try {
        const item = await terminalClient.create({ projectId, id });
        install(projectId, [item], true);
        get().select(projectId, item.id);
      } finally {
        release(id);
      }
    },
    async close(projectId, id) {
      await terminalClient.close(id);
      const { tabs, active, select } = get();
      const current = tabs[projectId] ?? [];
      const index = current.findIndex((item) => item.id === id);
      const remaining = current.filter((item) => item.id !== id);
      set((state) => {
        const output = { ...state.output };
        delete output[id];
        return { tabs: { ...state.tabs, [projectId]: remaining }, output };
      });
      if (active[projectId] === id)
        select(projectId, (remaining[index] ?? remaining[index - 1])?.id ?? null);
    },
    select(projectId, id) {
      set((state) => {
        const active = { ...state.active };
        if (id) active[projectId] = id;
        else delete active[projectId];
        return { active };
      });
    },
  };
});

onTerminalEvent('event', (event) => {
  const { output, tabs, pending, inFlight } = useTerminalStore.getState();
  const known = output[event.id];
  if (!known) {
    if (inFlight.includes(`list:${event.projectId}`) || inFlight.includes(event.id))
      useTerminalStore.setState({ pending: [...pending, event] });
    return;
  }
  if (event.sequence <= known.sequence) return;
  if (event.type === 'data') {
    useTerminalStore.setState({
      output: {
        ...output,
        [event.id]: {
          buffer: (known.buffer + event.data).slice(-BUFFER_LIMIT),
          sequence: event.sequence,
        },
      },
    });
    return;
  }
  useTerminalStore.setState({
    output: { ...output, [event.id]: { ...known, sequence: event.sequence } },
    tabs: {
      ...tabs,
      [event.projectId]: (tabs[event.projectId] ?? []).map((item) =>
        item.id === event.id ? { ...item, exitCode: event.exitCode } : item,
      ),
    },
  });
});
