import { useEffect, useMemo, useState } from 'react';
import { Popover } from 'radix-ui';
import { Check, ChevronDown, Cloud, Folder, GitBranch, MessageSquare, Search } from 'lucide-react';
import type { WorkspaceEntry } from '../../../shared/api';
import { useNavigationStore } from '../../navigation/view';
import { showToast } from '../../app/toasts';
import { errorText, useWorkspaceStore } from '../../workspace/store';
import type { ComposerContext } from './composer-context';

const pill =
  'flex h-7 min-w-0 max-w-[15rem] items-center gap-1.5 rounded-control border border-line bg-surface px-2 text-xs text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink';
const panel = 'z-50 w-64 rounded-card bg-surface p-1 shadow-raised';
const searchRow = 'mb-1 flex items-center gap-2 rounded-control px-2 py-1.5 text-ink-3';
const searchInput =
  'min-w-0 flex-1 bg-transparent text-13 text-ink outline-none placeholder:text-ink-3';
const option =
  'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-13 text-ink transition-colors duration-100 hover:bg-hover';
const empty = 'px-2 py-2 text-xs text-ink-3';
const contentStyle = {
  animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both',
  transformOrigin: 'bottom left',
} as const;

const matches = (value: string, query: string) =>
  value.toLowerCase().includes(query.trim().toLowerCase());

/** 新对话上方的项目浮岛：项目与分支各一个可点的胶囊，互不牵连。 */
export function ComposerContextBar({ context }: { context: ComposerContext }) {
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const projects = useMemo(() => entries.filter((entry) => entry.kind === 'project'), [entries]);
  const { projectId, remote } = context;
  const [current, setCurrent] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesFailed, setBranchesFailed] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [branchQuery, setBranchQuery] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  // 当前分支要一直显示在胶囊上，进新对话就读一次；远端仓库在另一台机器上，通用池没有项目。
  useEffect(() => {
    setCurrent(null);
    if (!projectId || remote || !window.dela) return;
    let active = true;
    void window.dela.workspace
      .projectBranch(projectId)
      .then((branch) => {
        if (active) setCurrent(branch);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, remote]);

  // 分支列表展开时才拉：仓库可能有很多分支，不必每次进新对话都读一遍。
  useEffect(() => {
    if (!branchOpen || !projectId || remote || !window.dela) return;
    let active = true;
    void window.dela.workspace
      .projectBranches(projectId)
      .then((list) => {
        if (active) setBranches(list);
      })
      .catch(() => {
        if (active) setBranchesFailed(true);
      });
    return () => {
      active = false;
    };
  }, [branchOpen, projectId, remote]);

  const local = (entry: WorkspaceEntry) =>
    entry.remoteId ? (
      <Cloud aria-hidden className="size-3.5 shrink-0" />
    ) : (
      <Folder aria-hidden className="size-3.5 shrink-0" />
    );

  const chooseProject = (id: string | null) => {
    setProjectOpen(false);
    if (id === projectId) return;
    // 选哪个项目就落到哪个项目：main 复用该项目已有的空会话，不会堆垃圾会话。
    useNavigationStore.getState().newChat(id);
  };

  const switchBranch = (branch: string) => {
    setBranchOpen(false);
    if (!projectId || branch === current || !window.dela) return;
    void window.dela.workspace
      .switchProjectBranch(projectId, branch)
      .then(() => setCurrent(branch))
      .catch((error: unknown) =>
        showToast({
          variant: 'error',
          title: '切换分支失败',
          description: errorText(error),
        }),
      );
  };

  const visibleProjects = projects.filter((entry) => matches(entry.name, projectQuery));
  const visibleBranches = branches.filter((branch) => matches(branch, branchQuery));

  return (
    <div className="mb-2 flex min-w-0 items-center gap-1.5">
      <Popover.Root onOpenChange={setProjectOpen} open={projectOpen}>
        <Popover.Trigger asChild>
          <button aria-label="切换项目" className={pill} type="button">
            {context.remote ? (
              <Cloud aria-hidden className="size-3.5 shrink-0" />
            ) : (
              <Folder aria-hidden className="size-3.5 shrink-0" />
            )}
            <span className="truncate text-ink-2">{context.name}</span>
            <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            className={panel}
            side="top"
            sideOffset={6}
            style={contentStyle}
          >
            <label className={searchRow}>
              <Search aria-hidden className="size-3.5 shrink-0" />
              <input
                aria-label="搜索项目"
                className={searchInput}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder="搜索项目"
                value={projectQuery}
              />
            </label>
            <div className="max-h-64 overflow-y-auto">
              {visibleProjects.map((entry) => (
                <button
                  className={option}
                  key={entry.id}
                  onClick={() => chooseProject(entry.id)}
                  type="button"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {local(entry)}
                    <span className="truncate">{entry.name}</span>
                  </span>
                  {entry.id === projectId && <Check aria-hidden className="size-3.5 shrink-0" />}
                </button>
              ))}
              {visibleProjects.length === 0 && <p className={empty}>没有匹配的项目</p>}
            </div>
            <div className="my-1 h-px bg-line" />
            <button className={option} onClick={() => chooseProject(null)} type="button">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <MessageSquare aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">不在项目里（随聊）</span>
              </span>
              {projectId === null && <Check aria-hidden className="size-3.5 shrink-0" />}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {current && (
        <Popover.Root onOpenChange={setBranchOpen} open={branchOpen}>
          <Popover.Trigger asChild>
            <button aria-label="切换分支" className={pill} type="button">
              <GitBranch aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{current}</span>
              <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              className={panel}
              side="top"
              sideOffset={6}
              style={contentStyle}
            >
              <label className={searchRow}>
                <Search aria-hidden className="size-3.5 shrink-0" />
                <input
                  aria-label="搜索分支"
                  className={searchInput}
                  onChange={(event) => setBranchQuery(event.target.value)}
                  placeholder="搜索分支"
                  value={branchQuery}
                />
              </label>
              <div className="max-h-64 overflow-y-auto">
                {visibleBranches.map((branch) => (
                  <button
                    className={option}
                    key={branch}
                    onClick={() => switchBranch(branch)}
                    type="button"
                  >
                    <GitBranch aria-hidden className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{branch}</span>
                    {branch === current && <Check aria-hidden className="size-3.5 shrink-0" />}
                  </button>
                ))}
                {branchesFailed ? (
                  <p className={empty}>分支列表加载失败</p>
                ) : (
                  visibleBranches.length === 0 && <p className={empty}>没有匹配的分支</p>
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
