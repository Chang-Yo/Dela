// 扩展的界面桥：按 Pi rpc 模式（modes/rpc/rpc-mode.ts）实现 ExtensionUIContext。对话框经 IPC 交给
// 渲染端弹出并等回复；通知、状态与文本小部件单向推送；TUI 组件类接口（custom、组件小部件、页眉页脚、
// 终端输入）在图形界面里没有对应物，返回 rpc 模式同样的安全默认值，并提示一次「该功能不可用」。
// 写得规范的扩展会以 ctx.mode === 'rpc' 自行降级。
import { randomUUID } from 'node:crypto';
import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';
import type {
  ExtensionSessionState,
  ExtensionUiEvent,
  ExtensionUiReply,
  ExtensionUiRequest,
} from '../../shared/packages';

type Send = (channel: string, payload: unknown) => void;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  sessionId: string;
  resolve: (value: ExtensionUiReply) => void;
}

const pending = new Map<string, Pending>();
const states = new Map<string, ExtensionSessionState>();
/** 渲染端的输入框正文：getEditorText 是同步接口，只能读渲染端最近一次上报的值。 */
const editorTexts = new Map<string, string>();

let send: Send = () => {};
export function setExtensionUiSender(sender: Send) {
  send = sender;
}

export function replyExtensionUi(id: string, value: ExtensionUiReply) {
  pending.get(id)?.resolve(value);
}

export function reportEditorText(sessionId: string, text: string) {
  editorTexts.set(sessionId, text);
}

export function extensionSessionState(sessionId: string): ExtensionSessionState {
  return states.get(sessionId) ?? { sessionId, statuses: [], widgets: [], workingMessage: null };
}

/** 会话被丢弃：未答复的对话框按取消处理，状态清空。 */
export function releaseExtensionUi(sessionId: string) {
  for (const item of [...pending.values()]) if (item.sessionId === sessionId) item.resolve(null);
  states.delete(sessionId);
  editorTexts.delete(sessionId);
  send('packages:session-state', extensionSessionState(sessionId));
}

export function emitExtensionUiEvent(event: ExtensionUiEvent) {
  send('packages:ui-event', event);
}

function dialog<T>(
  sessionId: string,
  request: DistributiveOmit<ExtensionUiRequest, 'id' | 'sessionId'>,
  options: ExtensionUIDialogOptions | undefined,
  fallback: T,
  parse: (value: ExtensionUiReply) => T,
): Promise<T> {
  if (options?.signal?.aborted) return Promise.resolve(fallback);
  const id = randomUUID();
  return new Promise<T>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: ExtensionUiReply) => {
      if (!pending.delete(id)) return;
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener('abort', abort);
      send('packages:ui-dismiss', id);
      resolve(value === null ? fallback : parse(value));
    };
    const abort = () => finish(null);
    options?.signal?.addEventListener('abort', abort, { once: true });
    if (options?.timeout) timer = setTimeout(abort, options.timeout);
    pending.set(id, { sessionId, resolve: finish });
    send('packages:ui-request', {
      ...request,
      id,
      sessionId,
      ...(options?.timeout ? { timeoutMs: options.timeout } : {}),
    } as ExtensionUiRequest);
  });
}

function mutate(sessionId: string, change: (state: ExtensionSessionState) => void) {
  const state = extensionSessionState(sessionId);
  const next = {
    ...state,
    statuses: [...state.statuses],
    widgets: [...state.widgets],
  };
  change(next);
  states.set(sessionId, next);
  send('packages:session-state', next);
}

/**
 * 与 rpc 模式一致的无界面成员。theme 是 Pi 的全局主题代理：扩展常在渲染函数里读它拼 ANSI 颜色，
 * Dela 在第一次绑定扩展前用 initTheme 初始化，否则一读就抛「Theme not initialized」。
 */
function headlessMembers(theme: ExtensionUIContext['theme']) {
  return {
    onTerminalInput: () => () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    addAutocompleteProvider: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return theme;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Dela 不支持切换终端主题' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  } satisfies Partial<ExtensionUIContext>;
}

/** 一个会话的 UI 上下文；onTitle 交给会话层改标题。 */
export function createExtensionUi(
  sessionId: string,
  theme: ExtensionUIContext['theme'],
  onTitle: (title: string) => void,
): ExtensionUIContext {
  const warned = new Set<string>();
  const unsupported = (feature: string) => {
    if (warned.has(feature)) return;
    warned.add(feature);
    emitExtensionUiEvent({ type: 'unsupported', sessionId, feature });
  };
  return {
    ...headlessMembers(theme),
    select: (title, options, opts) =>
      dialog(sessionId, { kind: 'select', title, options }, opts, undefined, (value) =>
        typeof value === 'string' && options.includes(value) ? value : undefined,
      ),
    confirm: (title, message, opts) =>
      dialog(
        sessionId,
        { kind: 'confirm', title, message },
        opts,
        false,
        (value) => value === true,
      ),
    input: (title, placeholder, opts) =>
      dialog(
        sessionId,
        { kind: 'input', title, ...(placeholder ? { placeholder } : {}) },
        opts,
        undefined,
        (value) => (typeof value === 'string' ? value : undefined),
      ),
    editor: (title, prefill) =>
      dialog(
        sessionId,
        { kind: 'editor', title, ...(prefill ? { prefill } : {}) },
        undefined,
        undefined,
        (value) => (typeof value === 'string' ? value : undefined),
      ),
    notify: (message, type) =>
      emitExtensionUiEvent({ type: 'notify', sessionId, message, level: type ?? 'info' }),
    setStatus: (key, text) =>
      mutate(sessionId, (state) => {
        state.statuses = state.statuses.filter((item) => item.key !== key);
        if (text) state.statuses.push({ key, text });
      }),
    setWorkingMessage: (message) =>
      mutate(sessionId, (state) => {
        state.workingMessage = message ?? null;
      }),
    setWidget: ((
      key: string,
      content: unknown,
      options?: { placement?: 'aboveEditor' | 'belowEditor' },
    ) => {
      if (content !== undefined && !Array.isArray(content)) {
        unsupported('自定义组件小部件');
        return;
      }
      mutate(sessionId, (state) => {
        state.widgets = state.widgets.filter((item) => item.key !== key);
        if (content)
          state.widgets.push({
            key,
            lines: (content as unknown[]).map(String),
            placement: options?.placement ?? 'aboveEditor',
          });
      });
    }) as ExtensionUIContext['setWidget'],
    setTitle: (title) => onTitle(title),
    setEditorText: (text) =>
      emitExtensionUiEvent({ type: 'editor-text', sessionId, text, mode: 'replace' }),
    pasteToEditor: (text) =>
      emitExtensionUiEvent({ type: 'editor-text', sessionId, text, mode: 'paste' }),
    getEditorText: () => editorTexts.get(sessionId) ?? '',
    custom: async () => {
      unsupported('自定义终端界面');
      return undefined as never;
    },
    // 传 undefined 是扩展在复位，不算用到了这个功能。
    setFooter: (factory) => factory && unsupported('自定义页脚'),
    setHeader: (factory) => factory && unsupported('自定义页眉'),
    setEditorComponent: (factory) => factory && unsupported('自定义输入框'),
  };
}
