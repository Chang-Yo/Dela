import { Plus } from 'lucide-react';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { CodeBlock } from './CodeBlock';

export function AgentPanel({ onCollapse }: { onCollapse: () => void }) {
  return (
    <aside
      className="flex min-w-0 flex-col overflow-hidden bg-muted/40 max-[1140px]:hidden"
      id="project-agent"
    >
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">Agent</p>
          <strong className="text-sm">检查报告</strong>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="新建会话"
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            title="新建会话"
            type="button"
          >
            <Plus className="size-4" />
          </button>
          <PanelToggleButton
            className="hover:bg-background"
            collapsed={false}
            controlsId="project-agent"
            label="Agent 面板"
            onToggle={onCollapse}
            side="right"
          />
        </div>
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
  );
}
