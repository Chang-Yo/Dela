import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import {
  Columns2,
  FilePlus2,
  Folder,
  FolderInput,
  FolderKanban,
  FolderPlus,
  GraduationCap,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import type { WorkspaceEntry } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { Resizer } from '../../components/ui/resizer';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { cn } from '../../lib/utils';
import { SourceList } from '../sources/SourceList';
import { ProjectDocument } from './ProjectDocument';
import { ProjectSidebar, type EntryAction } from './ProjectSidebar';
import { emptyView, errorText, useWorkspace } from './workspace';
import { AgentPanel } from './AgentPanel';

type Modal = { action: EntryAction | 'link' | 'connect'; id: string | null; text?: string };
const titles: Record<Modal['action'], string> = {
  folder: '新建文件夹',
  project: '新建项目',
  note: '新建笔记',
  rename: '重命名',
  move: '移动到',
  remove: '移除内容',
  promote: '作为项目开展',
  import: '关联本地文件',
  link: '加入文件夹或项目',
  connect: '连接 Canvas',
};

export function ProjectView({
  mode = 'project',
  projectId = null,
  onOpenProject,
  createRequested = false,
  onCreateHandled,
}: {
  mode?: 'project' | 'sources';
  projectId?: string | null;
  onOpenProject: (id: string) => void;
  createRequested?: boolean;
  onCreateHandled?: () => void;
}) {
  const workspace = useWorkspace((s) => s.workspace);
  const canvas = useWorkspace((s) => s.canvas);
  const globalError = useWorkspace((s) => s.error);
  const drafts = useWorkspace((s) => s.drafts);
  const rootId =
    mode === 'project' && workspace.entries.some((entry) => entry.id === projectId)
      ? projectId
      : null;
  const scope = mode === 'sources' ? 'sources' : (rootId ?? 'projects');
  const saved = workspace.views[scope] ?? emptyView;
  const root = workspace.entries.find((e) => e.id === rootId);
  const [selected, setSelected] = useState<string | null>(rootId);
  const [width, setWidth] = useState(300);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('dela.workspace.collapsed') === 'true',
  );
  const [resizing, setResizing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bySource, setBySource] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentWidth, setAgentWidth] = useState(340);
  const [quote, setQuote] = useState('');
  const [quoteSource, setQuoteSource] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const scrollPending = useRef<Record<string, number>>({});
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void useWorkspace.getState().load();
  }, []);
  useEffect(() => {
    localStorage.setItem('dela.workspace.collapsed', String(collapsed));
  }, [collapsed]);
  useEffect(() => {
    setSelected(rootId);
    setReference(null);
  }, [rootId]);
  useEffect(() => {
    if (createRequested) {
      show({ action: 'project', id: null });
      onCreateHandled?.();
    }
  }, [createRequested]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const reset = () => {
      if (media.matches) setMobileOpen(false);
    };
    media.addEventListener('change', reset);
    return () => media.removeEventListener('change', reset);
  }, []);
  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      if (Object.keys(scrollPending.current).length) {
        const state = useWorkspace.getState();
        const view = state.workspace.views[scope] ?? emptyView;
        state.setView(scope, { ...view, scroll: { ...view.scroll, ...scrollPending.current } });
      }
      scrollPending.current = {};
    },
    [scope],
  );
  const updateView = (patch: Partial<typeof saved>) =>
    useWorkspace.getState().setView(scope, {
      ...(useWorkspace.getState().workspace.views[scope] ?? emptyView),
      ...patch,
    });
  const expand = (id: string, open: boolean) => {
    const expanded = useWorkspace.getState().workspace.views[scope]?.expanded ?? [];
    updateView({
      expanded: open ? [...new Set([...expanded, id])] : expanded.filter((value) => value !== id),
    });
  };
  const open = (key: string) => {
    const view = useWorkspace.getState().workspace.views[scope] ?? emptyView;
    updateView({
      active: key,
      tabs: view.tabs.includes(key) ? view.tabs : [...view.tabs.slice(-99), key],
    });
    setSelected(key);
    setQuote('');
    setMobileOpen(false);
  };
  const title = (key: string) =>
    workspace.entries.find((e) => e.id === key)?.name ??
    canvas.items.find((i) => `source:${i.sourceId}` === key)?.name ??
    drafts[key]?.content.title ??
    '资料';
  const currentContainer = () => {
    const entry = workspace.entries.find((e) => e.id === (saved.active ?? selected));
    return entry
      ? entry.kind === 'folder' || entry.kind === 'project'
        ? entry.id
        : entry.parentId
      : rootId;
  };
  function show(value: Modal) {
    setName(
      value.action === 'rename'
        ? (workspace.entries.find((e) => e.id === value.id)?.name ?? '')
        : '',
    );
    setTarget(currentContainer() ?? '');
    setModalError(null);
    setModal(value);
  }
  const run = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      useWorkspace.getState().setError(error);
    }
  };
  const action = (type: EntryAction, id: string | null) => {
    if (type === 'promote' && id) {
      void run(async () => {
        await window.dela!.workspace.update(id, { kind: 'project' });
        await useWorkspace.getState().refresh();
        onOpenProject(id);
      });
    } else if (type === 'import')
      void run(async () => {
        await window.dela!.workspace.importFiles(id);
        await useWorkspace.getState().refresh();
      });
    else show({ action: type, id });
  };
  const selectEntry = (id: string) => {
    const item = workspace.entries.find((e) => e.id === id);
    if (!item) return;
    if (item.kind === 'project') {
      onOpenProject(id);
      setMobileOpen(false);
    } else if (item.kind === 'folder') {
      setSelected(id);
      expand(id, !saved.expanded.includes(id));
      updateView({ active: null });
    } else open(id);
  };
  const newNote = (text: string) => {
    const quoted = quote || text;
    const active = quote ? quoteSource : saved.active;
    const sourceId = active?.startsWith('source:')
      ? active.slice(7)
      : workspace.entries.find((e) => e.id === active)?.sourceId;
    const source = sourceId ? canvas.items.find((i) => i.sourceId === sourceId) : null;
    const originalUrl = active ? drafts[active]?.content.url : undefined;
    const header = source
      ? `来源：${originalUrl ? `[${source.name}](${originalUrl})` : source.name}\n\n`
      : '';
    show({
      action: 'note',
      id: currentContainer(),
      text:
        text ||
        `${header}${
          quoted
            ? quoted
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n') + '\n\n'
            : ''
        }`,
    });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!modal || !window.dela) return;
    setBusy(true);
    setModalError(null);
    try {
      const api = window.dela.workspace;
      let created: WorkspaceEntry | undefined;
      if (modal.action === 'connect') {
        await window.dela.canvas.configure(name);
        setName('');
        useWorkspace.getState().setCanvas(await window.dela.canvas.syncCourses());
      } else if (modal.action === 'rename') await api.update(modal.id!, { name });
      else if (modal.action === 'move') await api.update(modal.id!, { parentId: target || null });
      else if (modal.action === 'remove') {
        await api.remove(modal.id!);
        const remaining = (await api.getState()).entries;
        const live = new Set(remaining.map((e) => e.id));
        const tabs = saved.tabs.filter((key) => key.startsWith('source:') || live.has(key));
        updateView({
          tabs,
          active:
            saved.active && tabs.includes(saved.active) ? saved.active : (tabs.at(-1) ?? null),
        });
        if (rootId && !live.has(rootId)) onOpenProject('');
      } else if (modal.action === 'link') {
        const sourceId = modal.id!.startsWith('source:')
          ? modal.id!.slice(7)
          : workspace.entries.find((e) => e.id === modal.id)?.sourceId;
        if (!sourceId) throw new Error('请选择来源资料');
        let parentId = target || null;
        if (target === '__new__')
          parentId = (await api.create({ name, parentId: null, kind: 'project' })).id;
        created = await api.create({ name: title(modal.id!), parentId, kind: 'source', sourceId });
      } else if (modal.action === 'folder' || modal.action === 'project' || modal.action === 'note')
        created = await api.create({
          name,
          parentId: modal.id,
          kind: modal.action,
          text: modal.text,
        });
      await useWorkspace.getState().refresh();
      setModal(null);
      if (created) {
        if (created.parentId) expand(created.parentId, true);
        if (created.kind === 'project') onOpenProject(created.id);
        else if (created.kind === 'note') open(created.id);
        else if (created.kind === 'folder') {
          setSelected(created.id);
          updateView({ active: null });
          expand(created.id, true);
        }
      }
    } catch (error) {
      setModalError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const recordScroll = (key: string, top: number) => {
    scrollPending.current[key] = top;
    if (!scrollTimer.current)
      scrollTimer.current = setTimeout(() => {
        const state = useWorkspace.getState();
        const view = state.workspace.views[scope] ?? emptyView;
        state.setView(scope, { ...view, scroll: { ...view.scroll, ...scrollPending.current } });
        scrollPending.current = {};
        scrollTimer.current = null;
      }, 300);
  };
  const pathName = (entry: WorkspaceEntry): string => {
    const names = [entry.name];
    let parent = workspace.entries.find((e) => e.id === entry.parentId);
    while (parent) {
      names.unshift(parent.name);
      parent = workspace.entries.find((e) => e.id === parent!.parentId);
    }
    return names.join(' / ');
  };
  const folder =
    workspace.entries.find(
      (e) => e.id === selected && (e.kind === 'folder' || e.kind === 'project'),
    ) ?? root;
  const children = workspace.entries.filter((e) => e.parentId === (folder?.id ?? rootId));
  const renderDocument = (key: string, readOnly = false) => (
    <ProjectDocument
      key={key}
      documentKey={key}
      readOnly={readOnly}
      scroll={saved.scroll[key] ?? 0}
      onScroll={(top) => recordScroll(key, top)}
      onQuote={(text) => {
        setQuote(text);
        setQuoteSource(key);
      }}
      onLinkSource={(id) => show({ action: 'link', id })}
      onNewNote={newNote}
      onOpenSource={open}
    />
  );
  if (!window.dela)
    return (
      <DesktopOnlyNotice
        title="资料与项目"
        description="请在桌面应用中连接 Canvas、整理资料和编辑笔记。"
      />
    );
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
      {mobileOpen && (
        <button
          aria-label="关闭目录"
          className="absolute inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          'flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-muted/40 transition-[width] duration-150 ease-out motion-reduce:transition-none max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:!w-[280px] max-md:max-w-[85vw] max-md:bg-background max-md:shadow-xl',
          resizing && 'transition-none',
          !mobileOpen && 'max-md:hidden',
        )}
        style={{ width: collapsed ? 48 : width }}
      >
        <div className="flex min-h-0 flex-1 flex-col max-md:!w-full" style={{ width }}>
          <div className="flex h-11 shrink-0 items-center gap-1 px-2">
            <PanelToggleButton
              collapsed={collapsed}
              controlsId="workspace-explorer"
              label="目录"
              onToggle={() => (mobileOpen ? setMobileOpen(false) : setCollapsed((value) => !value))}
            />
            <button
              className={cn(
                'min-w-0 flex-1 truncate text-left text-xs font-medium text-muted-foreground hover:text-foreground',
                collapsed && !mobileOpen && 'invisible',
              )}
              onClick={() => {
                setSelected(rootId);
                updateView({ active: null });
              }}
            >
              {mode === 'sources' ? '资料' : (root?.name ?? '项目与文件夹')}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className={cn(collapsed && !mobileOpen && 'invisible')}
                  size="icon-sm"
                  variant="ghost"
                  aria-label="新建内容"
                  title="新建内容"
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => action('folder', currentContainer())}>
                  <FolderPlus />
                  新建文件夹
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => action('project', null)}>
                  <FolderKanban />
                  新建项目
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => action('note', currentContainer())}>
                  <FilePlus2 />
                  新建笔记
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => action('import', currentContainer())}>
                  <FolderInput />
                  关联本地文件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div
            id="workspace-explorer"
            className={cn('flex min-h-0 flex-1 flex-col', collapsed && !mobileOpen && 'invisible')}
          >
            <div className="relative mx-3 mb-2">
              <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
                aria-label="筛选已同步内容"
                placeholder="筛选已同步内容…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {mode === 'sources' && (
                <>
                  <div className="flex h-8 items-center gap-1 px-3">
                    <GraduationCap className="size-4 text-muted-foreground" />
                    <select
                      aria-label="资料分组方式"
                      className="min-w-0 flex-1 bg-transparent text-xs text-muted-foreground outline-none"
                      value={bySource ? 'source' : 'course'}
                      onChange={(e) => {
                        setBySource(e.target.value === 'source');
                        if (e.target.value === 'source') expand('canvas', true);
                      }}
                    >
                      <option value="course">按课程</option>
                      <option value="source">按来源</option>
                    </select>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="刷新课程列表"
                      aria-label="刷新课程列表"
                      disabled={syncing || !canvas.connected}
                      onClick={() => {
                        setSyncing(true);
                        void run(async () =>
                          useWorkspace
                            .getState()
                            .setCanvas(await window.dela!.canvas.syncCourses()),
                        ).finally(() => setSyncing(false));
                      }}
                    >
                      <RefreshCw className={cn(syncing && 'animate-spin')} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Canvas 连接"
                      aria-label="Canvas 连接"
                      onClick={() => show({ action: 'connect', id: null })}
                    >
                      <Settings2 />
                    </Button>
                  </div>
                  {!canvas.connected && (
                    <div className="px-4 py-3 text-xs text-muted-foreground">
                      <p>连接 Canvas，查看课程资料。</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        onClick={() => show({ action: 'connect', id: null })}
                      >
                        连接 Canvas
                      </Button>
                    </div>
                  )}
                  <SourceList
                    expanded={saved.expanded}
                    onExpand={expand}
                    onOpen={open}
                    selected={saved.active}
                    query={query}
                    bySource={bySource}
                  />
                  <div className="mx-3 mt-3 border-t pt-3 text-xs font-medium text-muted-foreground">
                    我的内容
                  </div>
                </>
              )}
              <ProjectSidebar
                entries={workspace.entries}
                rootId={rootId}
                selected={saved.active ?? selected}
                expanded={saved.expanded}
                onExpand={expand}
                onSelect={selectEntry}
                onAction={action}
                query={query}
              />
            </div>
            <button
              className="flex h-11 shrink-0 items-center gap-2 border-t px-4 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => action('import', currentContainer())}
            >
              <FolderInput className="size-4" />
              关联本地文件
            </button>
          </div>
        </div>
      </aside>
      {!collapsed && (
        <Resizer
          className="max-md:hidden"
          label="调整目录宽度"
          min={240}
          max={420}
          value={width}
          onChange={setWidth}
          onResizingChange={setResizing}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center border-b px-2">
          <Button
            className="md:hidden"
            size="icon-sm"
            variant="ghost"
            aria-label="打开目录"
            onClick={() => setMobileOpen(true)}
          >
            <Folder />
          </Button>
          <div
            role="tablist"
            aria-label="打开的内容"
            className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
          >
            {saved.tabs.map((key) => (
              <div
                key={key}
                className={cn(
                  'flex h-11 shrink-0 items-center border-b-2',
                  saved.active === key ? 'border-foreground' : 'border-transparent',
                )}
              >
                <button
                  role="tab"
                  aria-selected={saved.active === key}
                  className="max-w-48 truncate px-3 text-xs"
                  onClick={() => open(key)}
                >
                  {title(key)}
                  {drafts[key] && drafts[key].text !== drafts[key].saved ? ' •' : ''}
                </button>
                <button
                  className="mr-1 grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
                  aria-label={`关闭 ${title(key)}`}
                  onClick={() => {
                    const tabs = saved.tabs.filter((id) => id !== key);
                    updateView({
                      tabs,
                      active: saved.active === key ? (tabs.at(-1) ?? null) : saved.active,
                    });
                    if (reference === key) setReference(null);
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
          {saved.active && (
            <Button
              className="max-lg:hidden"
              size="icon-sm"
              variant="ghost"
              title={reference ? '结束并排阅读' : '固定当前文档并排阅读'}
              aria-label={reference ? '结束并排阅读' : '固定当前文档并排阅读'}
              onClick={() => setReference(reference ? null : saved.active)}
            >
              <Columns2 />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            title="助手"
            aria-label="打开助手"
            onClick={() => setAgentOpen((value) => !value)}
          >
            <MessageSquare />
          </Button>
        </div>
        {globalError && (
          <div
            role="alert"
            className="flex items-start gap-2 border-b px-4 py-2 text-xs text-destructive"
          >
            <span className="flex-1">{globalError}</span>
            <button
              aria-label="关闭错误提示"
              onClick={() => useWorkspace.getState().setError(null)}
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        {quote.trim() && (
          <div className="flex shrink-0 items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{quote}</span>
            <button className="shrink-0 font-medium" onClick={() => newNote('')}>
              记入笔记
            </button>
            <button aria-label="取消引用" onClick={() => setQuote('')}>
              <X className="size-3" />
            </button>
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1">
          {reference && (
            <div className="flex min-h-0 w-1/2 min-w-0 flex-col border-r max-lg:hidden">
              {renderDocument(reference, true)}
            </div>
          )}
          {saved.active ? (
            renderDocument(saved.active)
          ) : (
            <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6 md:p-8">
              <div className="mb-6 flex items-center gap-3">
                <FolderOpenIcon project={folder?.kind === 'project'} />
                <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">
                  {folder?.name ?? (mode === 'sources' ? '资料' : '项目与文件夹')}
                </h1>
                {folder && (
                  <Button size="sm" variant="ghost" onClick={() => action('rename', folder.id)}>
                    重命名
                  </Button>
                )}
              </div>
              <div className="mb-5 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => action('note', folder?.id ?? rootId)}>
                  <FilePlus2 />
                  新建笔记
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => action('folder', folder?.id ?? rootId)}
                >
                  <FolderPlus />
                  新建文件夹
                </Button>
                {folder?.kind === 'folder' && (
                  <Button size="sm" variant="outline" onClick={() => action('promote', folder.id)}>
                    <FolderKanban />
                    作为项目开展
                  </Button>
                )}
              </div>
              {children.length ? (
                <div className="grid">
                  {children.map((item) => (
                    <button
                      key={item.id}
                      className="flex min-w-0 items-center gap-3 border-b py-3 text-left text-sm hover:bg-muted/40"
                      onClick={() => selectEntry(item.id)}
                    >
                      {item.kind === 'folder' || item.kind === 'project' ? (
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <FilePlus2 className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{item.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {item.kind === 'project'
                          ? '项目'
                          : item.kind === 'source'
                            ? '资料引用'
                            : item.kind === 'note'
                              ? '笔记'
                              : ''}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {mode === 'sources'
                    ? '从左侧展开课程，或新建文件夹整理自己的内容。'
                    : '添加资料或写一篇笔记，从这里开始。'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {agentOpen && (
        <>
          <Resizer
            className="max-lg:hidden"
            label="调整助手宽度"
            min={280}
            max={520}
            direction={-1}
            value={agentWidth}
            onChange={setAgentWidth}
          />
          <div
            className="flex min-h-0 shrink-0 border-l max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:!w-full max-lg:bg-background"
            style={{ width: agentWidth }}
          >
            <AgentPanel
              scope={scope}
              tabs={saved.tabs}
              title={title}
              onCollapse={() => setAgentOpen(false)}
              onSaveNote={(text) => show({ action: 'note', id: currentContainer(), text })}
              onOpen={open}
            />
          </div>
        </>
      )}
      <Dialog.Root
        open={modal !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
            <Dialog.Title className="text-base font-semibold">
              {modal ? titles[modal.action] : ''}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-xs text-muted-foreground">
              {modal?.action === 'connect'
                ? '使用个人 Access Token，凭据加密保存在本机。'
                : modal?.action === 'remove'
                  ? '移除该内容及其子项的应用内记录。本地文件和 Canvas 原件会保留。'
                  : modal?.action === 'link'
                    ? '引用同一份资料，原位置保持不变。'
                    : modal?.action === 'note'
                      ? `笔记保存到 ${workspace.directory}`
                      : '按自己的主题组织内容。'}
            </Dialog.Description>
            <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4">
              {(modal?.action === 'link' || modal?.action === 'move') && (
                <label className="grid gap-2 text-sm">
                  位置
                  <select
                    aria-label="目标文件夹"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">我的内容</option>
                    {workspace.entries
                      .filter(
                        (e) => (e.kind === 'folder' || e.kind === 'project') && e.id !== modal?.id,
                      )
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {pathName(e)}
                        </option>
                      ))}
                    {modal.action === 'link' && <option value="__new__">新建项目…</option>}
                  </select>
                </label>
              )}
              {modal &&
                !['move', 'remove'].includes(modal.action) &&
                (modal.action !== 'link' || target === '__new__') && (
                  <label className="grid gap-2 text-sm">
                    {modal.action === 'connect' ? 'Access Token' : '名称'}
                    <Input
                      autoFocus
                      autoComplete="off"
                      type={modal.action === 'connect' ? 'password' : 'text'}
                      aria-label={modal.action === 'connect' ? 'Canvas Access Token' : '名称'}
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}
              {modalError && (
                <p role="alert" className="text-xs text-destructive">
                  {modalError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setModal(null)}>
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy
                    ? '处理中…'
                    : modal?.action === 'remove'
                      ? '移除'
                      : modal?.action === 'connect'
                        ? '连接'
                        : '确定'}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function FolderOpenIcon({ project }: { project?: boolean }) {
  return project ? (
    <FolderKanban className="size-6 shrink-0 text-muted-foreground" />
  ) : (
    <Folder className="size-6 shrink-0 text-muted-foreground" />
  );
}
