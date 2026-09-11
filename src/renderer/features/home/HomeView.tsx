import {
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  MoreHorizontal,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/PageHeader';
import { cn } from '../../lib/utils';

type HomeViewProps = { onOpenProject: () => void };

type ProjectCardProps = {
  code: string;
  monogram: 'amber' | 'green' | 'blue';
  name: string;
  description: string;
  status: string;
  updated: string;
  onClick?: () => void;
};

const monogramTone: Record<ProjectCardProps['monogram'], string> = {
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  green: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  blue: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
};

function ProjectCard({
  code,
  monogram,
  name,
  description,
  status,
  updated,
  onClick,
}: ProjectCardProps) {
  return (
    <button
      className="flex min-h-[188px] flex-col justify-between rounded-xl border bg-card p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-border hover:shadow-md"
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            'grid size-[38px] place-items-center rounded-lg font-semibold',
            monogramTone[monogram],
          )}
        >
          {code}
        </span>
        <MoreHorizontal className="size-4 text-muted-foreground" />
      </div>
      <div>
        <h3 className="mb-1 text-base font-semibold">{name}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>{status}</span>
        <span>{updated}</span>
      </div>
    </button>
  );
}

export function HomeView({ onOpenProject }: HomeViewProps) {
  return (
    <div className="page">
      <PageHeader
        actions={
          <>
            <Button
              className="min-w-[184px] justify-between max-md:min-w-0 max-md:px-0"
              variant="outline"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <Search className="size-4" />
                <span className="max-md:hidden">搜索</span>
              </span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground max-md:hidden">
                Ctrl K
              </kbd>
            </Button>
            <Button>
              <span aria-hidden="true">＋</span>
              <span className="max-md:hidden">新建项目</span>
            </Button>
          </>
        }
        eyebrow="9 月 10 日 · 星期四"
        title="下午好"
      />
      <div className="mt-5 flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3 text-[13px] text-foreground/70">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
          预览
        </span>
        当前内容为界面示例，尚未连接个人数据。
      </div>
      <section
        aria-label="今日概览"
        className="mt-4 grid grid-cols-[minmax(0,1.55fr)_minmax(280px,0.9fr)] gap-4 max-md:grid-cols-1"
      >
        <article className="min-h-[245px] rounded-xl border bg-card p-5 max-md:min-h-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">最近截止</p>
              <h2 className="text-base font-semibold tracking-tight">机器学习 Lab 1</h2>
            </div>
            <div className="grid h-[58px] w-[52px] place-items-center rounded-lg border bg-muted">
              <strong className="text-[22px] leading-none">12</strong>
              <span className="text-[9px] tracking-[0.1em] text-muted-foreground">SEP</span>
            </div>
          </div>
          <p className="mt-4 max-w-[470px] text-sm leading-relaxed text-foreground/75">
            完成实验报告，并核对提交格式与数据集引用。
          </p>
          <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <div
              aria-label="进度 60%"
              className="h-1 flex-1 overflow-hidden rounded-full bg-secondary"
            >
              <div className="h-full w-[60%] rounded-full bg-foreground" />
            </div>
            <span>3 / 5</span>
          </div>
          <Button
            onClick={onOpenProject}
            size="sm"
            variant="ghost"
            className="mt-4 px-0 hover:bg-transparent hover:underline"
          >
            继续工作 <ArrowRight className="size-3.5" />
          </Button>
        </article>
        <article className="min-h-[245px] rounded-xl border bg-card p-5 max-md:min-h-0">
          <p className="text-[11px] font-medium text-muted-foreground">需要留意</p>
          <ul className="mt-3 grid list-none gap-0 p-0">
            <li className="flex items-center gap-3 border-b py-3">
              <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-destructive/10 font-semibold text-destructive">
                !
              </span>
              <div>
                <strong className="text-sm">课程要求有更新</strong>
                <p className="mt-0.5 text-xs text-muted-foreground">Lab 1 · 2 小时前</p>
              </div>
            </li>
            <li className="flex items-center gap-3 border-b py-3">
              <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground">
                <RefreshCw className="size-3.5" />
              </span>
              <div>
                <strong className="text-sm">邮箱需要重新登录</strong>
                <p className="mt-0.5 text-xs text-muted-foreground">上次同步：昨天 22:14</p>
              </div>
            </li>
          </ul>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 px-0 hover:bg-transparent hover:underline"
          >
            查看全部 <ArrowUpRight className="size-3.5" />
          </Button>
        </article>
      </section>
      <section className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">工作区</p>
            <h2 className="text-base font-semibold tracking-tight">继续最近的项目</h2>
          </div>
          <Button size="sm" variant="secondary">
            全部项目
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 max-md:grid-cols-1">
          <ProjectCard
            code="ML"
            description="实验报告与提交清单"
            monogram="amber"
            name="机器学习 Lab 1"
            onClick={onOpenProject}
            status="3 项待完成"
            updated="12 分钟前"
          />
          <ProjectCard
            code="毕"
            description="文献阅读与周报"
            monogram="green"
            name="毕业设计"
            status="草稿已保存"
            updated="昨天"
          />
          <ProjectCard
            code="SR"
            description="材料与时间线"
            monogram="blue"
            name="暑研申请"
            status="1 项待确认"
            updated="9 月 8 日"
          />
        </div>
      </section>
      <section className="mt-8 flex items-center justify-between gap-4 rounded-xl border bg-muted/50 p-3 px-4 max-md:items-start">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-foreground">
            <CircleAlert className="size-4" />
          </span>
          <div>
            <strong className="text-sm">检查 Lab 1 报告缺项</strong>
            <p className="mt-0.5 text-xs text-muted-foreground">Agent 正等待你确认修改</p>
          </div>
        </div>
        <Button onClick={onOpenProject} size="sm" variant="secondary" className="max-md:hidden">
          打开任务
        </Button>
      </section>
    </div>
  );
}
