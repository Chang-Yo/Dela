import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/PageHeader';
import { cn } from '../../lib/utils';
import { CodeBlock } from './CodeBlock';

const projectItems = ['概览', '实验要求', 'slides.pdf', 'notes.md', '检查清单'];
const documentTabs = ['概览', 'notes.md', '检查清单'];

function itemIcon(index: number) {
  return index === 0 ? '⌂' : index < 3 ? '◇' : '□';
}

type ProjectViewProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
};

export function ProjectView({ activeTab, onTabChange }: ProjectViewProps) {
  const [agentWidth, setAgentWidth] = useState(340);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  const resizeAgent = (event: PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    setAgentWidth(Math.min(520, Math.max(280, start.width + start.x - event.clientX)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-5 pb-0 max-md:w-full max-md:p-4 max-md:pb-4">
      <PageHeader
        actions={
          <>
            <Button variant="secondary" className="max-md:hidden">
              打开文件夹
            </Button>
            <Button>
              <span aria-hidden="true">›</span>
              <span className="max-md:hidden">在 VS Code 中打开</span>
            </Button>
          </>
        }
        className="border-b-0 pb-4"
        eyebrow="项目 / 机器学习"
        title="Lab 1"
      />
      <div
        className="grid min-h-0 flex-1 grid-cols-[178px_minmax(360px,1fr)_6px_minmax(280px,var(--agent-width))] overflow-hidden rounded-t-xl border border-b-0 bg-card max-[1140px]:grid-cols-[150px_minmax(350px,1fr)] max-md:block max-md:overflow-visible max-md:rounded-xl max-md:border-b"
        style={{ '--agent-width': `${agentWidth}px` } as CSSProperties}
      >
        <aside className="border-r bg-muted/40 p-2 pt-4 max-md:flex max-md:gap-1 max-md:border-r-0 max-md:border-b max-md:overflow-x-auto max-md:p-2 max-md:pt-2">
          <p className="px-2 pb-2 text-[11px] font-medium text-muted-foreground max-md:hidden">
            项目内容
          </p>
          {projectItems.map((item, index) => {
            const selected = item === activeTab;
            return (
              <button
                className={cn(
                  'flex h-[35px] w-full shrink-0 items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors max-md:w-auto max-md:px-3',
                  selected
                    ? 'bg-background font-medium text-foreground shadow-xs'
                    : 'text-foreground/70 hover:bg-background/60 hover:text-foreground',
                )}
                key={item}
                onClick={() => onTabChange(item)}
                type="button"
              >
                <span aria-hidden="true" className="w-[18px] text-muted-foreground">
                  {itemIcon(index)}
                </span>
                {item}
              </button>
            );
          })}
          <button
            className="mt-5 h-[34px] w-[calc(100%-16px)] rounded-lg border border-dashed text-xs text-muted-foreground transition-colors hover:bg-background/60 max-md:hidden"
            type="button"
          >
            ＋ 添加资料
          </button>
        </aside>
        <section className="min-w-0 overflow-auto">
          <div className="flex h-12 overflow-x-auto border-b px-4">
            {documentTabs.map((tab) => (
              <button
                className={cn(
                  'relative whitespace-nowrap px-3 text-xs transition-colors',
                  activeTab === tab
                    ? 'font-semibold text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                key={tab}
                onClick={() => onTabChange(tab)}
                role="tab"
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="mx-auto max-w-[720px] px-6 py-12 max-md:px-4 max-md:py-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span aria-hidden="true" className="size-2 rounded-full bg-amber-500" />
              项目概览
            </div>
            <h2 className="max-w-[540px] text-[26px] leading-[1.35] tracking-tight max-md:text-[22px]">
              完成实验、核对要求并按时提交
            </h2>
            <p className="mt-3 max-w-[580px] text-sm leading-relaxed text-foreground/75">
              围绕实验要求整理资料、记录结果，并在提交前完成一次完整检查。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 max-md:grid-cols-1">
              <div className="grid gap-2 border-l-2 border-border py-3 pl-4">
                <span className="text-xs text-muted-foreground">截止时间</span>
                <strong className="text-sm">9 月 12 日 23:59</strong>
              </div>
              <div className="grid gap-2 border-l-2 border-border py-3 pl-4">
                <span className="text-xs text-muted-foreground">当前进度</span>
                <strong className="text-sm">60% · 3 项完成</strong>
              </div>
            </div>
            <div className="mt-8">
              <div className="mb-2 flex items-end justify-between gap-3">
                <h3 className="text-base font-semibold tracking-tight">下一步</h3>
                <Button size="sm" variant="secondary">
                  编辑
                </Button>
              </div>
              <label className="flex min-h-[43px] items-center gap-3 border-b text-sm">
                <input
                  defaultChecked
                  className="size-4 accent-foreground"
                  type="checkbox"
                />
                <span className="text-muted-foreground line-through">完成模型训练与记录</span>
              </label>
              <label className="flex min-h-[43px] items-center gap-3 border-b text-sm">
                <input className="size-4 accent-foreground" type="checkbox" />
                <span>补充误差分析图表</span>
              </label>
              <label className="flex min-h-[43px] items-center gap-3 border-b text-sm">
                <input className="size-4 accent-foreground" type="checkbox" />
                <span>核对报告命名与提交格式</span>
              </label>
            </div>
            <div className="mt-8">
              <h3 className="mb-3 text-base font-semibold tracking-tight">已关联资料</h3>
              <div className="flex items-center gap-3 border-b py-3">
                <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-muted text-[9px] font-extrabold text-foreground">
                  PDF
                </span>
                <div className="grid gap-0.5">
                  <strong className="text-sm">Lab1_requirements.pdf</strong>
                  <small className="text-xs text-muted-foreground">Canvas · 今天 10:30</small>
                </div>
              </div>
              <div className="flex items-center gap-3 border-b py-3">
                <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-muted text-[9px] font-extrabold text-foreground">
                  DIR
                </span>
                <div className="grid gap-0.5">
                  <strong className="text-sm">D:\Courses\ML\Lab1</strong>
                  <small className="text-xs text-muted-foreground">本地文件夹</small>
                </div>
              </div>
            </div>
          </div>
        </section>
        <div
          aria-label="调整 Agent 面板宽度"
          className="group relative cursor-col-resize touch-none focus-visible:outline-none max-[1140px]:hidden"
          onPointerDown={(event) => {
            resizeStart.current = { x: event.clientX, width: agentWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={resizeAgent}
          onPointerUp={(event) => {
            resizeStart.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          role="separator"
          tabIndex={0}
        >
          <span className="absolute inset-y-0 left-2 w-px bg-transparent transition-colors group-hover:bg-foreground/30 group-focus-visible:bg-foreground/40" />
        </div>
        <aside className="flex min-w-0 flex-col bg-muted/40 max-[1140px]:hidden">
          <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Agent</p>
              <strong className="text-sm">检查报告</strong>
            </div>
            <button
              aria-label="新建会话"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title="新建会话"
              type="button"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
            <div className="ml-5 rounded-xl rounded-br-sm bg-secondary px-3 py-3 text-sm leading-relaxed text-secondary-foreground">
              帮我对照实验要求，检查报告还缺什么。
            </div>
            <div className="mt-5 flex gap-2">
              <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                D
              </span>
              <div>
                <p className="text-sm leading-relaxed text-foreground/80">
                  已阅读实验要求和当前报告，发现两处待补充内容。
                </p>
                <CodeBlock
                  code={'# 按课程要求提交实验报告\npython submit.py --lab 1 --report report.pdf'}
                  language="bash"
                />
                <div className="mt-3 rounded-lg border bg-background px-2 py-2 text-xs text-muted-foreground">
                  <span className="mr-1 text-emerald-600 dark:text-emerald-400">✓</span> 已完成 2
                  个读取步骤
                </div>
                <button
                  className="mt-3 text-xs font-semibold text-foreground underline-offset-2 hover:underline"
                  type="button"
                >
                  查看检查结果 →
                </button>
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t p-3">
            <div className="mb-2 flex justify-between text-[11px] text-muted-foreground">
              <span>上下文 · 3 项资料</span>
              <button className="text-foreground underline-offset-2 hover:underline" type="button">
                管理
              </button>
            </div>
            <div className="relative">
              <textarea
                aria-label="发送给 Agent"
                className="w-full resize-none rounded-xl border bg-background px-3 py-3 pr-11 text-sm leading-normal outline-none transition-[box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="继续询问…"
                rows={3}
              />
              <button
                className="absolute right-2 bottom-2 grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90"
                title="发送"
                type="button"
              >
                ↑
              </button>
            </div>
            <small className="mt-2 block text-center text-[10px] text-muted-foreground">
              资料仅在你发送请求时提供给模型
            </small>
          </div>
        </aside>
      </div>
    </div>
  );
}
