import { ArrowRight, FolderKanban, GraduationCap, Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useWorkspace } from '../projects/workspace';
import { AgentPanel } from '../projects/AgentPanel';

export function HomeView({
  onOpenProject,
  onNewProject,
  onOpenSources,
}: {
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onOpenSources: () => void;
}) {
  const workspace = useWorkspace((s) => s.workspace);
  const canvas = useWorkspace((s) => s.canvas);
  const projects = workspace.entries.filter((e) => e.kind === 'project');
  return (
    <div className="page">
      <section
        className="mb-6 flex max-h-96 flex-col overflow-hidden rounded-xl border"
        aria-label="助手"
      >
        <AgentPanel
          scope="home"
          tabs={[]}
          title={(key) => key}
          home
          onOpen={onOpenSources}
          onSaveNote={(text) => {
            void window.dela?.workspace
              .create({ parentId: null, kind: 'note', name: '助手笔记', text })
              .then(() => useWorkspace.getState().refresh())
              .catch(useWorkspace.getState().setError);
          }}
        />
      </section>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">继续工作</h1>
        <Button onClick={onNewProject}>
          <Plus />
          新建项目
        </Button>
      </div>
      <section
        className="mt-6 grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1"
        aria-label="最近项目"
      >
        {projects.map((project) => {
          const view = workspace.views[project.id];
          const last = workspace.entries.find((e) => e.id === view?.active);
          return (
            <button
              key={project.id}
              className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted/40"
              onClick={() => onOpenProject(project.id)}
            >
              <FolderKanban className="size-5 text-muted-foreground" />
              <strong className="truncate text-base">{project.name}</strong>
              <span className="truncate text-xs text-muted-foreground">
                {last ? `继续 ${last.name}` : '打开工作区'}
              </span>
            </button>
          );
        })}
      </section>
      {!projects.length && (
        <p className="mt-6 text-sm text-muted-foreground">
          还没有项目。可以先浏览课程资料，也可以围绕一个主题新建项目。
        </p>
      )}
      <button
        className="mt-8 flex w-full items-center gap-3 rounded-xl border p-4 text-left hover:bg-muted/40"
        onClick={onOpenSources}
      >
        <GraduationCap className="size-5 text-muted-foreground" />
        <span className="flex-1">
          <strong className="text-sm">课程资料</strong>
          <span className="mt-1 block text-xs text-muted-foreground">
            {canvas.connected
              ? `${canvas.courses.length} 门课程 · 按学期浏览`
              : '连接 Canvas，查看课程文件与作业'}
          </span>
        </span>
        <ArrowRight className="size-4 text-muted-foreground" />
      </button>
    </div>
  );
}
