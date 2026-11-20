import type { ReactNode } from 'react';
import { cn } from '../../../ui/lib/cn';

type StepGuideItem = {
  title: string;
  content: ReactNode;
};

export function StepGuide({ steps }: { steps: StepGuideItem[] }) {
  return (
    <ol className="grid">
      {steps.map((step, index) => (
        <li className="grid grid-cols-[auto_1fr] gap-x-3" key={step.title}>
          <div className="flex flex-col items-center">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line bg-inset text-xs font-medium text-ink-3">
              {index + 1}
            </span>
            {index < steps.length - 1 && <span className="my-1.5 w-px flex-1 bg-line" />}
          </div>
          <div className={cn('grid content-start gap-3', index < steps.length - 1 && 'pb-9')}>
            <h3 className="text-sm font-medium leading-6 text-ink">{step.title}</h3>
            {step.content}
          </div>
        </li>
      ))}
    </ol>
  );
}
