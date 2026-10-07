import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardPaste, Copy, Plus, SquareTerminal, X } from 'lucide-react';
import type { TerminalEvent, TerminalSession } from '../../../shared/terminal';
import type { TabComponentProps } from '../../workbench/registry';
import { Button } from '../../components/ui/button';
import { errorText } from '../../workspace/store';
import { cn } from '../../lib/utils';
import '@xterm/xterm/css/xterm.css';

const activeByProject = new Map<string, string>();
const BUFFER_LIMIT = 1024 * 1024;

// xterm 的配色解析器不支持 oklch；借浏览器画布转换现有主题 token。
function terminalColor(value: string): string {
  const context = document.createElement('canvas').getContext('2d')!;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

// 选区底色在前景色上叠透明度，亮暗主题下文字均保持可读；
// terminalColor 只输出 rgb，透明色直接拼 rgba 字符串（xterm 主题原生支持），不再过画布取样。
function withAlpha(color: string, alpha: number): string {
  return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
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

export function TerminalTab({ tabId }: TabComponentProps) {
  const api = window.dela?.terminal;
  const projectId = tabId.slice('terminal:'.length);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(activeByProject.get(projectId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [hasSelection, setHasSelection] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const screen = useRef<{ id: string; terminal: Terminal } | null>(null);
  const snapshots = useRef<TerminalSession[]>([]);
  const pending = useRef<TerminalEvent[]>([]);
  const waitingIds = useRef(new Set<string>());
  const loading = useRef(true);
  const mounted = useRef(false);

  const copy = async () => {
    const text = screen.current?.terminal.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const paste = async () => {
    const current = screen.current;
    if (!current || current.terminal.options.disableStdin) return;
    try {
      const text = await navigator.clipboard.readText();
      if (screen.current !== current) return;
      current.terminal.paste(text);
      current.terminal.focus();
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    }
  };

  const select = (id: string | null) => {
    if (id) activeByProject.set(projectId, id);
    else activeByProject.delete(projectId);
    setActiveId(id);
  };
  const install = (items: TerminalSession[]) => {
    const merged = items.map((item) =>
      pending.current.filter((event) => event.id === item.id).reduce(applyEvent, item),
    );
    const installed = new Set(items.map((item) => item.id));
    pending.current = pending.current.filter((event) => !installed.has(event.id));
    snapshots.current = merged;
    setSessions(merged);
    return merged;
  };
  const create = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    const id = crypto.randomUUID();
    waitingIds.current.add(id);
    try {
      const item = await api.create(projectId, id);
      if (!mounted.current) return;
      install([...snapshots.current, item]);
      select(item.id);
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      waitingIds.current.delete(id);
      if (mounted.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (!api) {
      setError('内置终端仅在桌面应用中可用');
      setBusy(false);
      return;
    }
    let alive = true;
    mounted.current = true;
    const unsubscribe = api.onEvent((event) => {
      if (event.projectId !== projectId) return;
      const item = snapshots.current.find((item) => item.id === event.id);
      if (!item) {
        if (loading.current || waitingIds.current.has(event.id)) pending.current.push(event);
        return;
      }
      if (event.sequence <= item.sequence) return;
      const next = applyEvent(item, event);
      snapshots.current = snapshots.current.map((item) => (item.id === event.id ? next : item));
      setSessions(snapshots.current);
      if (event.type === 'data' && screen.current?.id === event.id)
        screen.current.terminal.write(event.data);
    });
    void api
      .list(projectId)
      .then(async (items) => {
        if (!alive) return;
        loading.current = false;
        if (!items.length) {
          await create();
          return;
        }
        const merged = install(items);
        const remembered = activeByProject.get(projectId);
        select(merged.find((item) => item.id === remembered)?.id ?? merged[0]!.id);
        setBusy(false);
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(errorText(cause));
          setBusy(false);
        }
      });
    return () => {
      alive = false;
      mounted.current = false;
      unsubscribe();
    };
    // 订阅的生命周期以项目为界；输出、活动会话通过 ref 接入，不反复建立 IPC 订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectId]);

  const activeExists = sessions.some((item) => item.id === activeId);
  useEffect(() => {
    const element = host.current;
    const session = snapshots.current.find((item) => item.id === activeId);
    if (!api || !element || !session) return;
    const style = getComputedStyle(element);
    const foreground = terminalColor(style.color);
    const terminal = new Terminal({
      fontFamily: style.fontFamily,
      fontSize: parseFloat(style.fontSize),
      theme: {
        background: terminalColor(style.backgroundColor),
        foreground,
        cursor: foreground,
        // block 光标内文字取终端背景色，与光标块形成反色。
        cursorAccent: terminalColor(style.backgroundColor),
        selectionBackground: withAlpha(foreground, 0.28),
        selectionInactiveBackground: withAlpha(foreground, 0.16),
      },
      disableStdin: session.exitCode !== null,
      altClickMovesCursor: true,
      cursorStyle: 'block',
      cursorBlink: true,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    // 回放旧输出时不能把旧设备查询的响应再次送给仍在运行的 Shell。
    let replaying = true;
    terminal.write(session.buffer, () => {
      replaying = false;
    });
    screen.current = { id: session.id, terminal };
    setHasSelection(false);
    const selection = terminal.onSelectionChange(() => setHasSelection(terminal.hasSelection()));
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
        if (event.code === 'KeyC' || event.code === 'KeyV') {
          event.preventDefault();
          if (event.code === 'KeyC') void copy();
          else void paste();
          return false;
        }
      }
      return true;
    });
    const reportError = (cause: unknown) => {
      if (mounted.current) setError(errorText(cause));
    };
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      fit.fit();
      void api.resize(session.id, terminal.cols, terminal.rows).catch(reportError);
    };
    const input = terminal.onData((data) => {
      if (replaying) return;
      void api.write(session.id, data).catch(reportError);
    });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const themeObserver = new MutationObserver(() => {
      const style = getComputedStyle(element);
      const foreground = terminalColor(style.color);
      terminal.options.theme = {
        background: terminalColor(style.backgroundColor),
        foreground,
        cursor: foreground,
        cursorAccent: terminalColor(style.backgroundColor),
        selectionBackground: withAlpha(foreground, 0.28),
        selectionInactiveBackground: withAlpha(foreground, 0.16),
      };
      terminal.options.fontSize = parseFloat(style.fontSize);
      resize();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    resize();
    terminal.focus();
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      selection.dispose();
      screen.current = null;
      terminal.dispose();
    };
  }, [activeId, api, activeExists]);

  const active = sessions.find((item) => item.id === activeId);
  useEffect(() => {
    if (screen.current) screen.current.terminal.options.disableStdin = active?.exitCode !== null;
  }, [active?.exitCode]);

  const close = async (id: string) => {
    if (!api) return;
    try {
      await api.close(id);
      if (!mounted.current) return;
      const index = snapshots.current.findIndex((item) => item.id === id);
      const remaining = snapshots.current.filter((item) => item.id !== id);
      install(remaining);
      if (activeId === id) select(remaining[index]?.id ?? remaining[index - 1]?.id ?? null);
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <div
          aria-label="终端会话"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
          role="tablist"
        >
          {sessions.map((session, index) => (
            <div
              key={session.id}
              className={cn(
                'flex shrink-0 items-center rounded-md text-sm text-muted-foreground',
                session.id === activeId && 'bg-accent text-foreground',
              )}
            >
              <button
                aria-selected={session.id === activeId}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 focus-visible:outline focus-visible:outline-ring"
                role="tab"
                type="button"
                onClick={() => select(session.id)}
              >
                <SquareTerminal className="size-4" />
                {session.title} {index + 1}
                {session.exitCode !== null && (
                  <span className="text-xs text-muted-foreground">已结束</span>
                )}
              </button>
              <Button
                aria-label={`关闭终端 ${index + 1}`}
                title="关闭终端"
                variant="ghost"
                size="icon-xs"
                onClick={() => void close(session.id)}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
        <Button
          aria-label="复制终端选区"
          title="复制选区（Ctrl+Shift+C）"
          disabled={!hasSelection}
          variant="ghost"
          size="icon-sm"
          onClick={() => void copy()}
        >
          <Copy />
        </Button>
        <Button
          aria-label="粘贴到终端"
          title="粘贴（Ctrl+Shift+V）"
          disabled={!active || active.exitCode !== null}
          variant="ghost"
          size="icon-sm"
          onClick={() => void paste()}
        >
          <ClipboardPaste />
        </Button>
        <Button
          aria-label="新建终端"
          title="新建终端"
          disabled={busy}
          variant="ghost"
          size="icon-sm"
          onClick={() => void create()}
        >
          <Plus />
        </Button>
      </div>
      {error && (
        <p className="shrink-0 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {active?.exitCode !== null && active && (
        <p className="shrink-0 px-3 py-1 text-xs text-muted-foreground">
          进程已结束，退出码 {active.exitCode}。可新建终端继续操作。
        </p>
      )}
      {!activeId && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {busy ? '正在打开终端…' : '点击 + 新建终端'}
        </div>
      )}
      <div
        ref={host}
        title="拖动选取文本；Alt+单击移动输入光标；右键复制选区或粘贴"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (screen.current?.terminal.hasSelection()) void copy();
          else void paste();
        }}
        className={cn(
          'min-h-0 flex-1 overflow-hidden bg-background p-2 font-mono text-sm text-foreground',
          !activeId && 'hidden',
        )}
      />
    </div>
  );
}
