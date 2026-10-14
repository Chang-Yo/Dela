import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

type StepGuideItem = {
  title: string;
  content: ReactNode;
};

/** 向导步骤内的编号引导：序号圆点 + 竖向连线，把「先去拿密钥、再回来粘贴」拆成上下两段。
 *  序号与标题同为 24px 行高，圆心与文字基线对齐；步骤之间留白远大于标题与内容之间，靠亲密性分层。 */
export function StepGuide({ steps }: { steps: StepGuideItem[] }) {
  return (
    <ol className="grid">
      {steps.map((step, index) => (
        <li className="grid grid-cols-[auto_1fr] gap-x-3" key={step.title}>
          <div className="flex flex-col items-center">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line bg-inset text-xs font-medium text-ink-3">
              {index + 1}
            </span>
            {index < steps.length - 1 && <span className="my-1.5 w-px flex-1 bg-hover-2" />}
          </div>
          <div className={cn('grid content-start gap-3', index < steps.length - 1 && 'pb-9')}>
            <h3 className="text-13 font-medium leading-6 text-ink">{step.title}</h3>
            {step.content}
          </div>
        </li>
      ))}
    </ol>
  );
}
