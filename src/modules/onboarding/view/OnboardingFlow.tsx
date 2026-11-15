import { useState } from 'react';
import type { ViewDefinition } from '../../../app/module';
import { LlmStep } from './steps/LlmStep';
import { ConsentStep } from './ConsentStep';
import { IntroSequence } from './IntroSequence';
import { WizardShell } from './WizardShell';
import { CapabilitySetup } from './CapabilitySetup';
import { onboardingClient } from './client';

type OnboardingFlowProps = {
  /** 外壳注入的视图清单：各模块经 onboarding 登记自己的向导步骤。 */
  views: ViewDefinition[];
  /** 向导走完过：只缺条款的老用户补完条款即进入应用。 */
  completed: boolean;
  /** 完成包含能力拓展的六步向导，由宿主播放结束动画。 */
  onWizardDone: () => void;
  /** 已完成配置的用户只补条款，不重走向导。 */
  onConsentDone: () => void;
};

/**
 * 首次启动引导：Intro 动画 → 条款接受 → 六步配置向导；已完成配置的用户只补条款。
 * 完成动画由宿主在主界面之上渲染（CompletionOverlay），不属于本组件。
 */
export function OnboardingFlow({
  views,
  completed,
  onConsentDone,
  onWizardDone,
}: OnboardingFlowProps) {
  // 尚未迁入模块的步骤仍写在这里，迁移后改由视图定义的 onboarding 登记。
  const wizardSteps = [...views.flatMap((view) => view.onboarding ?? []), LlmStep];
  // 已完成向导时跳过开场动画。
  const [introDone, setIntroDone] = useState(completed);
  const [step, setStep] = useState(0);
  const [consented, setConsented] = useState(false);

  const advance = () => setStep(step + 1);
  const back = () => {
    if (step > 0) setStep(step - 1);
  };
  // 条款接受记录由 ConsentStep 逐份写入主进程。
  const accept = () => {
    if (completed) onConsentDone();
    else setConsented(true);
  };

  if (!introDone) {
    return <IntroSequence onStart={() => setIntroDone(true)} />;
  }

  // 条款门：使用条款与隐私条款都读到最底部并同意后才放行，这一页没有跳过。
  // 只有已经有本机数据的安装才需要「导出本机数据」这个出口。
  // 它不算向导的一步，所以进度点仍从五步开始。
  if (!consented) return <ConsentStep canBackup={completed} onAgree={accept} />;

  const CurrentStep = wizardSteps[step];
  const capabilityStep = step === wizardSteps.length;
  return (
    <CapabilitySetup
      onDone={() => {
        void onboardingClient.complete().catch(() => {});
        onWizardDone();
      }}
    >
      {(content, footer) => (
        <WizardShell
          onBack={step > 0 ? back : undefined}
          onSkip={capabilityStep ? undefined : advance}
          step={step}
          stepCount={wizardSteps.length + 1}
          footer={capabilityStep ? footer : undefined}
        >
          {capabilityStep ? content : CurrentStep && <CurrentStep onDone={advance} />}
        </WizardShell>
      )}
    </CapabilitySetup>
  );
}
