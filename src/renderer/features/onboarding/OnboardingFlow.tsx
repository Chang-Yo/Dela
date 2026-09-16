import { useCallback, useState } from 'react';
import { CampusStep } from './steps/CampusStep';
import { CanvasStep } from './steps/CanvasStep';
import { LlmStep } from './steps/LlmStep';
import { MailStep } from './steps/MailStep';
import { ShuiyuanStep } from './steps/ShuiyuanStep';
import { IntroSequence } from './IntroSequence';
import { WizardShell } from './WizardShell';
import { markOnboardingCompleted, readWizardStep, saveWizardStep } from './onboarding-state';

const wizardSteps = [MailStep, CampusStep, CanvasStep, ShuiyuanStep, LlmStep];

type OnboardingFlowProps = {
  /** 向导走完（配置完成或全部跳过）后回调；宿主随即挂载主界面并叠加完成动画。 */
  onWizardDone: () => void;
};

/**
 * 首次启动引导：Intro 动画（视频/品牌/Quote）→ 五步配置向导。
 * 完成动画由宿主在主界面之上渲染（CompletionOverlay），不属于本组件。
 */
export function OnboardingFlow({ onWizardDone }: OnboardingFlowProps) {
  // 中途退出过的用户直接回到向导对应步骤，不再重播 Intro。
  const [introDone, setIntroDone] = useState(() => readWizardStep() !== null);
  // 钳制到合法区间，防御被手工改坏的 localStorage 值。
  const [step, setStep] = useState(() => Math.min(readWizardStep() ?? 0, wizardSteps.length - 1));

  const advance = useCallback(() => {
    const next = step + 1;
    if (next >= wizardSteps.length) {
      markOnboardingCompleted();
      onWizardDone();
      return;
    }
    saveWizardStep(next);
    setStep(next);
  }, [step, onWizardDone]);

  if (!introDone) {
    return <IntroSequence onStart={() => setIntroDone(true)} />;
  }

  const CurrentStep = wizardSteps[step]!;
  return (
    <WizardShell onSkip={advance} step={step} stepCount={wizardSteps.length}>
      <CurrentStep onDone={advance} />
    </WizardShell>
  );
}
