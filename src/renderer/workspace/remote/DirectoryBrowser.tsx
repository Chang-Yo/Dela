// 远端目录选择器：只列目录。单击选中、双击（或 →）进入、← / Backspace 返回上一级；
// 路径栏平时是面包屑，点一下变成输入框，可粘贴路径回车跳转。
// 已读过的目录走 remote-state 的缓存：返回上一级、再进来都是即时的，后台再静默刷新一次。
// 读取中不禁用任何东西：路径栏立刻变，列表显示占位，用户可以继续往别处点。
// 底栏「新建文件夹」在当前目录下建一层，建好后重读清单并选中它，可直接作为项目目录；
// 失败是瞬时结果，走 toast，输入框保留原名方便改了再试。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, Clock, Folder, FolderPlus, House, Search } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import type { RemoteBrowseResult, RemoteDraft } from '../../../shared/api';
import { showToast } from '../../app/toasts';
import { errorText } from '../store';
import { useRemoteState } from './remote-state';

function crumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  return [
    { name: '/', path: '/' },
    ...parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` })),
  ];
}

/** 主目录里的路径显示成 `~/…`：短，也是用户在终端里习惯的写法。 */
export function tildePath(path: string, home: string | null): string {
  if (!home || home === '/') return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function DirectoryBrowser({
  draft,
  destination,
  home,
  recent,
  path,
  selected,
  onNavigate,
  onSelect,
}: {
  draft: RemoteDraft;
  destination: string;
  home: string | null;
  /** 这台服务器上已登记过的项目目录：一键跳过去。 */
  recent: string[];
  path: string;
  /** 选中的子目录；null 表示项目目录就是当前路径。 */
  selected: string | null;
  onNavigate: (path: string) => void;
  onSelect: (path: string | null) => void;
}) {
  const cached = useRemoteState((state) => state.listings[`${destination}|${path}`]);
  const cacheListing = useRemoteState((state) => state.cacheListing);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(path);
  /** 新建文件夹的名字；null 表示没在新建。 */
  const [creating, setCreating] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // draft 每次渲染都是新对象：读取只跟着连接参数与路径走，用 ref 拿最新值。
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftKey = `${draft.host}|${draft.port ?? ''}|${draft.keyPath ?? ''}`;

  // 进到一个目录就读一次：有缓存先显示缓存，同时静默刷新，远端在 Dela 之外改过也看得到。
  useEffect(() => {
    const remotes = window.dela?.remotes;
    if (!remotes) return;
    let live = true;
    setError(null);
    setLoading(true);
    void remotes.browse(draftRef.current, path).then(
      (result: RemoteBrowseResult) => {
        if (!live) return;
        cacheListing(destination, result);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!live) return;
        setError(errorText(cause));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [draftKey, path, cacheListing]);

  useEffect(() => {
    setFilter('');
    setTyped(path);
    setCreating(null);
  }, [path]);

  const createFolder = async () => {
    const remotes = window.dela?.remotes;
    const name = creating?.trim();
    if (!remotes || !name) return;
    // 主进程同样会拦；这里先拦是为了给出人话，而不是 zod 的校验转储。
    const invalid = /[/\0]/.test(name)
      ? '文件夹名不能包含 /，只能新建一层'
      : name === '.' || name === '..'
        ? '文件夹名不能是 . 或 ..'
        : null;
    if (invalid) {
      showToast({ variant: 'error', title: '无法新建文件夹', description: invalid });
      return;
    }
    try {
      const created = await remotes.mkdir(draftRef.current, path, name);
      cacheListing(destination, await remotes.browse(draftRef.current, path));
      setCreating(null);
      onSelect(created);
    } catch (cause) {
      showToast({ variant: 'error', title: '新建文件夹失败', description: errorText(cause) });
    }
  };

  const directories = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (cached?.directories ?? []).filter(
      (entry) =>
        (showHidden || !entry.name.startsWith('.')) &&
        (!needle || entry.name.toLowerCase().includes(needle)),
    );
  }, [cached, filter, showHidden]);

  const parent =
    cached?.parent ?? (path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/');

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = directories.findIndex((entry) => entry.path === selected);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next =
        event.key === 'ArrowDown'
          ? Math.min(index + 1, directories.length - 1)
          : Math.max(index - 1, 0);
      const entry = directories[next];
      if (entry) onSelect(entry.path);
    } else if ((event.key === 'ArrowRight' || event.key === 'Enter') && selected) {
      event.preventDefault();
      onNavigate(selected);
    } else if ((event.key === 'ArrowLeft' || event.key === 'Backspace') && parent) {
      event.preventDefault();
      onNavigate(parent);
    }
  };

  // 选中项跟着键盘移动时滚进视野。
  useEffect(() => {
    if (!selected) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] overflow-hidden rounded-card border border-line">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button
          aria-label="主目录"
          className="grid size-6 shrink-0 place-items-center rounded-chip text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink disabled:opacity-40"
          disabled={!home}
          onClick={() => home && onNavigate(home)}
          title="主目录"
          type="button"
        >
          <House className="size-3.5" />
        </button>
        {editing ? (
          <Input
            aria-label="远端路径"
            autoFocus
            className="h-7 font-mono text-xs"
            onBlur={() => setEditing(false)}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const value = typed.trim().replace(/^~(?=\/|$)/, home ?? '~');
                if (value.startsWith('/')) onNavigate(value.replace(/\/+$/, '') || '/');
                setEditing(false);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setEditing(false);
              }
            }}
            value={typed}
          />
        ) : (
          <button
            aria-label="编辑路径"
            className="flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-chip px-1 text-left font-mono text-xs hover:bg-hover"
            onClick={() => setEditing(true)}
            title={`${path}（点击输入路径）`}
            type="button"
          >
            <span className="flex min-w-0 items-center overflow-hidden whitespace-nowrap [direction:rtl]">
              <span className="flex items-center [direction:ltr]">
                {crumbs(path).map((crumb, index, all) => (
                  <span className="flex items-center" key={crumb.path}>
                    {index > 1 && <ChevronRight className="size-3 shrink-0 text-ink-3/70" />}
                    <span
                      className={cn(
                        'rounded-chip px-0.5',
                        index === all.length - 1 ? 'text-ink' : 'text-ink-3 hover:text-ink',
                      )}
                      onClick={(event) => {
                        if (index === all.length - 1) return;
                        event.stopPropagation();
                        onNavigate(crumb.path);
                      }}
                    >
                      {crumb.name}
                    </span>
                  </span>
                ))}
              </span>
            </span>
          </button>
        )}
        <label className="relative w-32 shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input
            aria-label="过滤目录"
            className="h-7 pl-7 text-xs"
            onChange={(event) => setFilter(event.target.value)}
            placeholder="过滤"
            value={filter}
          />
        </label>
      </div>

      {recent.length > 0 ? (
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-line px-2.5 py-1.5 text-2xs">
          <Clock className="size-3 shrink-0 text-ink-3" aria-hidden="true" />
          <span className="shrink-0 text-ink-3">最近</span>
          {recent.map((item) => (
            <button
              className="shrink-0 rounded-chip bg-hover px-1.5 py-0.5 font-mono text-ink-2 transition-colors duration-150 hover:bg-hover-2 hover:text-ink"
              key={item}
              onClick={() => onNavigate(item)}
              title={item}
              type="button"
            >
              {tildePath(item, home)}
            </button>
          ))}
        </div>
      ) : (
        <div />
      )}

      <ul
        aria-busy={loading}
        aria-label="远端目录"
        className="min-h-48 overflow-y-auto py-1 outline-none focus-visible:bg-hover/40"
        onKeyDown={onListKey}
        ref={listRef}
        role="listbox"
        tabIndex={0}
      >
        {creating !== null && (
          <li className="px-2 py-1">
            <div className="flex items-center gap-2 px-1">
              <FolderPlus className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
              <Input
                aria-label="新文件夹名称"
                autoFocus
                className="h-7 text-xs"
                onChange={(event) => setCreating(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void createFolder();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setCreating(null);
                  }
                }}
                placeholder="新文件夹名称，回车创建"
                value={creating}
              />
            </div>
          </li>
        )}
        {parent && (
          <li>
            <button
              className="flex h-7 w-full items-center gap-2 px-3 text-left text-13 text-ink-3 hover:bg-hover hover:text-ink"
              onClick={() => onNavigate(parent)}
              tabIndex={-1}
              type="button"
            >
              <Folder className="size-4 shrink-0" strokeWidth={1.8} />
              ..
            </button>
          </li>
        )}
        {directories.map((entry) => (
          <li
            aria-selected={entry.path === selected}
            data-path={entry.path}
            key={entry.path}
            role="option"
          >
            <button
              className={cn(
                'flex h-7 w-full min-w-0 items-center gap-2 px-3 text-left text-13 transition-colors duration-100',
                entry.path === selected
                  ? 'bg-hover-2 text-ink'
                  : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
              onClick={() => onSelect(entry.path === selected ? null : entry.path)}
              onDoubleClick={() => onNavigate(entry.path)}
              tabIndex={-1}
              title={`${entry.path}（双击进入）`}
              type="button"
            >
              <Folder
                className={cn(
                  'size-4 shrink-0',
                  entry.name.startsWith('.') ? 'text-ink-3/60' : 'text-ink-3',
                )}
                strokeWidth={1.8}
              />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <ChevronRight
                className="size-3.5 shrink-0 text-ink-3/70 hover:text-ink"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(entry.path);
                }}
              />
            </button>
          </li>
        ))}
        {!cached &&
          loading &&
          [0, 1, 2, 3].map((index) => (
            <li className="flex h-7 items-center gap-2 px-3" key={index}>
              <span className="size-4 rounded-chip bg-hover" />
              <span
                className="h-2.5 rounded-full bg-hover"
                style={{ width: `${40 + index * 12}%` }}
              />
            </li>
          ))}
        {cached && directories.length === 0 && (
          <li className="px-3 py-2 text-xs text-ink-3">
            {filter ? '没有匹配的目录。' : '此目录下没有子目录。'}
          </li>
        )}
        {error && (
          <li className="px-3 py-2 text-xs [overflow-wrap:anywhere] text-red" role="alert">
            {error}
          </li>
        )}
      </ul>

      <div className="flex items-center justify-between border-t border-line px-2.5 py-1.5 text-2xs text-ink-3">
        <span className="flex-1" />
        <button
          className="mr-3 flex items-center gap-1 rounded-chip px-1 py-0.5 hover:bg-hover hover:text-ink"
          onClick={() => {
            setCreating('');
          }}
          type="button"
        >
          <FolderPlus className="size-3" />
          新建文件夹
        </button>
        <label className="flex items-center gap-1.5">
          <input
            checked={showHidden}
            className="size-3 accent-[var(--ink-2)]"
            onChange={(event) => setShowHidden(event.target.checked)}
            type="checkbox"
          />
          显示隐藏目录
        </label>
      </div>
    </div>
  );
}
