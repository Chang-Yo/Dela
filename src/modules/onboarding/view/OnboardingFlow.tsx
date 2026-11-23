import { useState } from 'react';
import type { ViewDefinition } from '../../../app/module';
import { LlmStep } from './steps/LlmStep';
import { DocumentStep } from './steps/DocumentStep';
import { ConsentStep } from './ConsentStep';
import { IntroSequence } from './IntroSequence';
import { WizardShell } from './WizardShell';
import { onboardingClient } from './client';

type OnboardingFlowProps = {
  views: ViewDefinition[];
  completed: boolean;
  onWizardDone: () => void;
  onConsentDone: () => void;
};

/** 首次启动引导：Intro → 条款 → 向导；已完成配置的用户只补条款。完成动画由宿主渲染。 */
export function OnboardingFlow({
  views,
  completed,
  onConsentDone,
  onWizardDone,
}: OnboardingFlowProps) {
  const wizardSteps = [...views.flatMap((view) => view.onboarding ?? []), LlmStep, DocumentStep];
  const [introDone, setIntroDone] = useState(completed);
  const [step, setStep] = useState(0);
  const [consented, setConsented] = useState(false);

  const lastStep = step === wizardSteps.length - 1;
  const advance = () => {
    if (!lastStep) return setStep(step + 1);
    void onboardingClient.complete().catch(() => {});
    onWizardDone();
  };
  const back = () => {
    if (step > 0) setStep(step - 1);
  };
  const accept = () => {
    if (completed) onConsentDone();
    else setConsented(true);
  };

  if (!introDone) {
    return <IntroSequence onStart={() => setIntroDone(true)} />;
  }

  // 条款门：两份条款读到底并同意才放行，没有跳过。「导出本机数据」出口只给已有本机数据的安装，
  // 条款页不算向导的一步。
  if (!consented) return <ConsentStep canBackup={completed} onAgree={accept} />;

  const CurrentStep = wizardSteps[step]!;
  return (
    <WizardShell
      onBack={step > 0 ? back : undefined}
      onSkip={advance}
      step={step}
      stepCount={wizardSteps.length}
      footer={
        lastStep ? (
          <p className="text-center text-xs text-ink-3">文档只在 Agent 读取时上传到 MinerU</p>
        ) : undefined
      }
    >
      <CurrentStep onDone={advance} />
    </WizardShell>
  );
}
