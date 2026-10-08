import type { ReactNode } from 'react';

type StepGuideItem = {
  title: string;
  content: ReactNode;
};

/** 向导步骤内的编号引导：序号圆点 + 竖向连线，把「先去拿密钥、再回来粘贴」拆成上下两段。 */
export function StepGuide({ steps }: { steps: StepGuideItem[] }) {
  return (
    <ol className="grid">
      {steps.map((step, index) => (
        <li className="grid grid-cols-[auto_1fr] gap-x-3" key={step.title}>
          <div className="flex flex-col items-center">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line bg-inset text-[12px] font-medium text-ink-3">
              {index + 1}
            </span>
            {index < steps.length - 1 && <span className="my-1.5 w-px flex-1 bg-hover-2" />}
          </div>
          <div className="grid content-start gap-3 pb-6 last:pb-0">
            <h3 className="pt-0.5 text-[13px] font-medium leading-6 text-ink">{step.title}</h3>
            {step.content}
          </div>
        </li>
      ))}
    </ol>
  );
}
