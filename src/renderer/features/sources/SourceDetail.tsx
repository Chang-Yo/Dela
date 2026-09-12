import { Button } from '../../components/ui/button';

export function SourceDetail() {
  return (
    <article className="overflow-auto p-8 max-md:p-5">
      <div className="mx-auto w-full max-w-[720px]">
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
      </div>
    </article>
  );
}
