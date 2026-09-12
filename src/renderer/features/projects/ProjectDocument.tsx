import { FolderOpen, PanelRightOpen, SquareArrowOutUpRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';

const documentTabs = ['概览', 'notes.md', '检查清单'];

type ProjectDocumentProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  agentCollapsed: boolean;
  onExpandAgent: () => void;
};

export function ProjectDocument({
  activeTab,
  onTabChange,
  agentCollapsed,
  onExpandAgent,
}: ProjectDocumentProps) {
  return (
    <section className="min-w-0 overflow-auto">
      <div className="flex h-12 overflow-x-auto border-b px-4">
        <div className="flex min-w-0 overflow-x-auto">
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
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-3">
          <button
            aria-label="打开文件夹"
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="打开文件夹"
            type="button"
          >
            <FolderOpen className="size-4" strokeWidth={1.8} />
          </button>
          <button
            aria-label="在 VS Code 中打开"
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="在 VS Code 中打开"
            type="button"
          >
            <SquareArrowOutUpRight className="size-4" strokeWidth={1.8} />
          </button>
          {agentCollapsed && (
            <button
              aria-label="展开 Agent 面板"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-[1140px]:hidden"
              onClick={onExpandAgent}
              title="展开 Agent 面板"
              type="button"
            >
              <PanelRightOpen className="size-4" strokeWidth={1.8} />
            </button>
          )}
        </div>
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
            <input defaultChecked className="size-4 accent-foreground" type="checkbox" />
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
  );
}
