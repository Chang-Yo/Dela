import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { OnboardingWindowBar } from './onboarding-window-bar';

type WizardShellProps = {
  /** 当前步骤下标（0 起）。 */
  step: number;
  stepCount: number;
  /** 回到上一步；第 0 步不传，左下角不渲染回退按钮。 */
  onBack?: () => void;
  /** 跳过当前步骤（最后一步时即完成引导）。 */
  onSkip: () => void;
  children: ReactNode;
};

/** 全屏白色向导框架：顶部拖拽区与步骤进度点，顶部锚定的内容列（各步标题起点一致，切换时视线不跳），左下「上一步」、底部「跳过」。配色固定，不随主题。 */
export function WizardShell({ step, stepCount, onBack, onSkip, children }: WizardShellProps) {
  // 进退方向决定内容滑入/滑出的水平朝向：前进从右进、后退从左回，与移动方向一致。
  const prevStepRef = useRef(step);
  const direction = step >= prevStepRef.current ? 1 : -1;
  useEffect(() => {
    prevStepRef.current = step;
  }, [step]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="grid h-dvh grid-rows-[auto_1fr_auto] bg-white text-neutral-900">
        <OnboardingWindowBar>
          <div
            aria-label={`第 ${step + 1} 步，共 ${stepCount} 步`}
            className="flex items-center gap-2"
            role="group"
          >
            {Array.from({ length: stepCount }, (_, index) => (
              <span
                aria-current={index === step ? 'step' : undefined}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  index === step ? 'w-5 bg-[var(--onboarding-accent)]' : 'w-1.5 bg-neutral-300',
                )}
                key={index}
              />
            ))}
          </div>
        </OnboardingWindowBar>
        <div className="grid min-h-0 content-start justify-items-center overflow-y-auto p-6">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="w-full max-w-[420px] pt-16"
              exit={{ opacity: 0, x: -16 * direction }}
              initial={{ opacity: 0, x: 24 * direction }}
              key={step}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 pb-7">
          <div className="justify-self-start">
            {onBack && (
              <button
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm text-neutral-500 transition-colors hover:text-neutral-700"
                onClick={onBack}
                type="button"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                上一步
              </button>
            )}
          </div>
          <button
            className="rounded-md px-4 py-2 text-sm text-neutral-500 transition-colors hover:text-neutral-700"
            onClick={onSkip}
            type="button"
          >
            跳过
          </button>
          <span aria-hidden="true" />
        </div>
      </div>
    </MotionConfig>
  );
}
