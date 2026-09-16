import type { ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { OnboardingWindowBar } from './onboarding-window-bar';

type WizardShellProps = {
  /** 当前步骤下标（0 起）。 */
  step: number;
  stepCount: number;
  /** 跳过当前步骤（最后一步时即完成引导）。 */
  onSkip: () => void;
  children: ReactNode;
};

/** 全屏白色向导框架：顶部拖拽区与步骤进度点，居中内容列，底部「跳过」。配色固定，不随主题。 */
export function WizardShell({ step, stepCount, onSkip, children }: WizardShellProps) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="grid h-dvh grid-rows-[auto_1fr_auto] bg-white text-neutral-900">
        <OnboardingWindowBar>
          <div
            aria-label={`第 ${step + 1} 步，共 ${stepCount} 步`}
            className="flex items-center gap-2"
          >
            {Array.from({ length: stepCount }, (_, index) => (
              <span
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  index === step ? 'w-5 bg-[var(--onboarding-accent)]' : 'w-1.5 bg-neutral-300',
                )}
                key={index}
              />
            ))}
          </div>
        </OnboardingWindowBar>
        <div className="grid min-h-0 place-items-center overflow-y-auto p-6">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="w-full max-w-[420px]"
              exit={{ opacity: 0, x: -16 }}
              initial={{ opacity: 0, x: 24 }}
              key={step}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="grid place-items-center pb-7">
          <button
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-600"
            onClick={onSkip}
            type="button"
          >
            跳过
          </button>
        </div>
      </div>
    </MotionConfig>
  );
}
