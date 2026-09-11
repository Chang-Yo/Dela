import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';

const courseItems = [
  { name: '机器学习 · Lab 1', meta: '9 月 12 日截止' },
  { name: '计算机网络 · Assignment 2', meta: '9 月 18 日截止' },
  { name: '人工智能 · 课程通知', meta: '昨天更新' },
];

export function SourcesView() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.8fr)_minmax(320px,1.2fr)] overflow-hidden bg-card max-[1080px]:grid-cols-[minmax(240px,0.75fr)_minmax(280px,1fr)] max-md:block max-md:overflow-auto">
      <section className="border-r bg-muted/40 p-3 max-md:border-r-0 max-md:border-b">
        <div className="flex items-center justify-between gap-3 p-2">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">课程内容</p>
            <span className="text-[10px] text-muted-foreground">示例数据</span>
          </div>
          <button
            aria-label="刷新资料"
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            title="刷新资料"
            type="button"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.8} />
          </button>
        </div>
        {courseItems.map((item, index) => (
          <button
            className={cn(
              'grid w-full gap-2 rounded-lg p-3 text-left transition-colors',
              index === 0 ? 'bg-background shadow-xs' : 'hover:bg-background/60',
            )}
            key={item.name}
            type="button"
          >
            <strong className="text-sm">{item.name}</strong>
            <span className="text-xs text-muted-foreground">{item.meta}</span>
          </button>
        ))}
      </section>
      <article className="overflow-auto p-8 max-md:p-5">
        <p className="text-[11px] font-medium text-muted-foreground">Canvas · 作业</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Lab 1: Classification</h2>
        <div className="mt-5 grid gap-1 border-y py-3">
          <span className="text-xs text-muted-foreground">截止时间</span>
          <strong className="text-sm">9 月 12 日 23:59</strong>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-foreground/75">
          完成分类模型训练、结果分析与实验报告。报告需包含数据预处理、参数选择和误差讨论。
        </p>
        <div className="mt-6 flex gap-2">
          <Button size="sm" variant="secondary">
            打开原文
          </Button>
          <Button size="sm">加入项目</Button>
        </div>
      </article>
    </div>
  );
}
