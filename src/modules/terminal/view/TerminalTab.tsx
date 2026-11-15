import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardPaste, Copy, Plus, SquareTerminal, X } from 'lucide-react';
import { onTerminalEvent, terminalClient } from './client';
import { useTerminalStore } from './store';
import { showToast } from '../../../ui/toast';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/cn';
import { platform } from '../../../renderer/lib/platform';
import '@xterm/xterm/css/xterm.css';
import { ErrorText } from '../../../ui/alert';
import { errorMessage } from '../../../core/protocol/contract';

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

const noTabs: never[] = [];

export function TerminalTab({ tabId }: { tabId: string }) {
  const desktop = Boolean(window.dela);
  const projectId = tabId.slice('terminal:'.length);
  const tabs = useTerminalStore((state) => state.tabs[projectId]) ?? noTabs;
  const remembered = useTerminalStore((state) => state.active[projectId]);
  const select = useTerminalStore((state) => state.select);
  const [creating, setCreating] = useState(false);
  const [reported, setReported] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const screen = useRef<Terminal | null>(null);

  // 上次选中的会话已不在了就落到第一个。
  const active = tabs.find((item) => item.id === remembered) ?? tabs[0];
  const activeId = active?.id ?? null;

  const create = async () => {
    if (!desktop) return;
    setCreating(true);
    setReported(null);
    try {
      await useTerminalStore.getState().create(projectId);
    } catch (cause) {
      showToast({ variant: 'error', title: '新建终端失败', description: errorMessage(cause) });
    } finally {
      setCreating(false);
    }
  };

  // 打开标签时读一次清单；没有会话就新建一个。离开标签即丢弃，下次打开重读。
  const opened = useQuery({
    queryKey: ['terminal', 'open', projectId],
    queryFn: async () => {
      const items = await useTerminalStore.getState().load(projectId);
      if (!items.length) await create();
      return null;
    },
    enabled: desktop,
    gcTime: 0,
    staleTime: Infinity,
  });
  const busy = desktop && (opened.isPending || creating);
  const error = desktop
    ? (reported ?? (opened.error ? errorMessage(opened.error) : null))
    : '内置终端仅在桌面应用中可用';

  const copy = async () => {
    const text = screen.current?.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (cause) {
      showToast({ variant: 'error', title: '复制失败', description: errorMessage(cause) });
    }
  };
  const paste = async () => {
    const current = screen.current;
    if (!current || current.options.disableStdin) return;
    try {
      const text = await navigator.clipboard.readText();
      if (screen.current !== current) return;
      current.paste(text);
      current.focus();
    } catch (cause) {
      showToast({ variant: 'error', title: '粘贴失败', description: errorMessage(cause) });
    }
  };

  useEffect(() => {
    const element = host.current;
    const session = useTerminalStore.getState().output[activeId ?? ''];
    if (!element || !activeId || !session) return;
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
      // ANSI 默认色板按暗色背景设计；与 VS Code 一致按 WCAG AA 自动调整对比度。
      minimumContrastRatio: 4.5,
      disableStdin: active?.exitCode !== null,
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
    screen.current = terminal;
    const selection = terminal.onSelectionChange(() => setHasSelection(terminal.hasSelection()));
    terminal.attachCustomKeyEventHandler((event) => {
      const clipboardModifier =
        platform === 'mac'
          ? event.metaKey && !event.ctrlKey && !event.shiftKey
          : event.ctrlKey && !event.metaKey && event.shiftKey;
      if (event.type === 'keydown' && clipboardModifier && !event.altKey) {
        if (event.code === 'KeyC' || event.code === 'KeyV') {
          event.preventDefault();
          if (event.code === 'KeyC') void copy();
          else void paste();
          return false;
        }
      }
      return true;
    });
    const reportError = (cause: unknown) => setReported(errorMessage(cause));
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      fit.fit();
      void terminalClient
        .resize({ id: activeId, cols: terminal.cols, rows: terminal.rows })
        .catch(reportError);
    };
    const input = terminal.onData((data) => {
      if (replaying) return;
      void terminalClient.write({ id: activeId, data }).catch(reportError);
    });
    // 缓冲与订阅在同一刻取得：之后到的输出直接写进终端，store 里同时累积供下次回放。
    let lastSequence = session.sequence;
    const stopEvents = onTerminalEvent('event', (event) => {
      if (event.id !== activeId || event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
      if (event.type === 'data') terminal.write(event.data);
      else terminal.options.disableStdin = true;
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
      stopEvents();
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      selection.dispose();
      screen.current = null;
      setHasSelection(false);
      terminal.dispose();
    };
  }, [activeId]);

  const close = async (id: string) => {
    try {
      await useTerminalStore.getState().close(projectId, id);
    } catch (cause) {
      showToast({ variant: 'error', title: '关闭终端失败', description: errorMessage(cause) });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <div
          aria-label="终端会话"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
          role="tablist"
        >
          {tabs.map((session, index) => (
            <div
              key={session.id}
              className={cn(
                'flex shrink-0 items-center rounded-control text-sm text-ink-3',
                session.id === activeId && 'bg-hover text-ink',
              )}
            >
              <button
                aria-selected={session.id === activeId}
                className="flex items-center gap-2 rounded-control px-3 py-1.5 focus-visible:outline focus-visible:outline-accent"
                role="tab"
                type="button"
                onClick={() => select(projectId, session.id)}
              >
                <SquareTerminal className="size-4" />
                {session.title} {index + 1}
                {session.exitCode !== null && <span className="text-xs text-ink-3">已结束</span>}
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
          title={platform === 'mac' ? '复制选区（⌘C）' : '复制选区（Ctrl+Shift+C）'}
          disabled={!hasSelection}
          variant="ghost"
          size="icon-sm"
          onClick={() => void copy()}
        >
          <Copy />
        </Button>
        <Button
          aria-label="粘贴到终端"
          title={platform === 'mac' ? '粘贴（⌘V）' : '粘贴（Ctrl+Shift+V）'}
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
        <ErrorText size="sm" className="shrink-0 px-3 py-2">
          {error}
        </ErrorText>
      )}
      {active?.exitCode !== null && active && (
        <p className="shrink-0 px-3 py-1 text-xs text-ink-3">
          进程已结束，退出码 {active.exitCode}。可新建终端继续操作。
        </p>
      )}
      {!activeId && (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-3">
          {busy ? '正在打开终端…' : '点击 + 新建终端'}
        </div>
      )}
      <div
        ref={host}
        title="拖动选取文本；Alt+单击移动输入光标；右键复制选区或粘贴"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (screen.current?.hasSelection()) void copy();
          else void paste();
        }}
        className={cn(
          'min-h-0 flex-1 overflow-hidden bg-surface p-2 font-mono text-sm text-ink',
          !activeId && 'hidden',
        )}
      />
    </div>
  );
}
