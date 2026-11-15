import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { OnboardingWindowBar } from './onboarding-window-bar';
import { Button } from '../../../ui/button';

type WizardShellProps = {
  /** 当前步骤下标（0 起）。 */
  step: number;
  stepCount: number;
  /** 回到上一步；第 0 步不传，左下角不渲染回退按钮。 */
  onBack?: () => void;
  /** 跳过当前步骤（最后一步时即完成引导）。 */
  onSkip?: () => void;
  /** 最后一步以完成按钮替换底部说明，沿用同一导航与过渡框架。 */
  footer?: ReactNode;
  children: ReactNode;
};

/** 全屏白色向导框架：内容列顶部锚定，各步标题起点一致、切换时视线不跳；配色固定，不随主题。 */
export function WizardShell({
  step,
  stepCount,
  onBack,
  onSkip,
  footer,
  children,
}: WizardShellProps) {
  // 进退方向决定内容滑入的水平朝向：前进从右进、后退从左回；首屏为 0，不播放入场。
  const [motionStep, setMotionStep] = useState({ step, direction: 0 });
  if (motionStep.step !== step) {
    setMotionStep({ step, direction: step > motionStep.step ? 1 : -1 });
  }
  const { direction } = motionStep;

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] bui-light bg-surface text-ink">
      <OnboardingWindowBar>
        {stepCount > 0 && (
          <div
            aria-label={`第 ${step + 1} 步，共 ${stepCount} 步`}
            className="flex items-center gap-2"
            role="group"
          >
            {Array.from({ length: stepCount }, (_, index) => (
              <span
                aria-current={index === step ? 'step' : undefined}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-slower',
                  index === step ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong',
                )}
                key={index}
              />
            ))}
          </div>
        )}
      </OnboardingWindowBar>
      <div className="grid min-h-0 content-start justify-items-center overflow-y-auto p-6 [@media(max-height:560px)]:p-4">
        <div
          // 顶部锚定保证各步标题起点一致；矮窗口下收缩留白，给表单内容让出高度。
          className={cn(
            'w-full max-w-[26.25rem] pt-16 motion-reduce:animate-none [@media(max-height:560px)]:pt-6',
            direction > 0 && 'animate-step-in-next',
            direction < 0 && 'animate-step-in-prev',
          )}
          key={step}
        >
          {children}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(5rem,1fr)_minmax(0,26.25rem)_minmax(5rem,1fr)] items-center gap-4 px-6 pb-4 [@media(max-height:560px)]:pb-3">
        <div className="justify-self-start">
          {onBack && (
            <Button className="text-ink-3" onClick={onBack} variant="ghost">
              <ArrowLeft aria-hidden="true" />
              上一步
            </Button>
          )}
        </div>
        {footer ?? <p className="text-center text-xs text-ink-3">所有数据本地存储，不上传服务器</p>}
        {onSkip ? (
          <Button className="justify-self-end text-ink-3" onClick={onSkip} variant="ghost">
            跳过
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
