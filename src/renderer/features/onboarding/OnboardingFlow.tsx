import { useCallback, useState } from 'react';
import { CampusStep } from './steps/CampusStep';
import { CanvasStep } from './steps/CanvasStep';
import { LlmStep } from './steps/LlmStep';
import { MailStep } from './steps/MailStep';
import { ShuiyuanStep } from './steps/ShuiyuanStep';
import { ConsentStep } from './ConsentStep';
import { IntroSequence } from './IntroSequence';
import { WizardShell } from './WizardShell';
import { CapabilitySetup } from './CapabilitySetup';
import {
  hasConsent,
  markOnboardingCompleted,
  needsWizard,
  readWizardStep,
  saveConsent,
  saveWizardStep,
} from './onboarding-state';

const wizardSteps = [MailStep, CampusStep, CanvasStep, ShuiyuanStep, LlmStep];

type OnboardingFlowProps = {
  /** 完成包含能力拓展的六步向导，由宿主播放结束动画。 */
  onWizardDone: () => void;
  /** 已完成配置的用户补完条款后由宿主检查能力拓展版本，不重走向导。 */
  onConsentDone: () => void;
};

/**
 * 首次启动引导：Intro 动画 → 条款接受 → 五步配置向导；已完成配置的用户只补条款，由宿主检查能力拓展入口。
 * 完成动画由宿主在主界面之上渲染（CompletionOverlay），不属于本组件。
 */
export function OnboardingFlow({ onConsentDone, onWizardDone }: OnboardingFlowProps) {
  // 启动时是否跳过整个引导由 App 判定；这里仅管理当前流程内的步骤。
  // 已完成向导时跳过开场动画。
  const [introDone, setIntroDone] = useState(() => !needsWizard());
  // 钳制到合法区间，防御被手工改坏的 localStorage 值。
  const [step, setStep] = useState(() => Math.min(readWizardStep() ?? 0, wizardSteps.length));
  const [consented, setConsented] = useState(hasConsent);
  // 只有已经有本机数据的安装才需要「导出本机数据」这个出口，全新安装没有可导出的东西。
  const [canBackup] = useState(() => !needsWizard());

  const advance = useCallback(() => {
    const next = step + 1;
    saveWizardStep(next);
    setStep(next);
  }, [step]);

  const back = useCallback(() => {
    if (step === 0) return;
    saveWizardStep(step - 1);
    setStep(step - 1);
  }, [step]);

  const accept = useCallback(() => {
    saveConsent();
    // 已完成配置的用户不重走配置向导，由宿主检查能力拓展入口。
    if (needsWizard()) setConsented(true);
    else onConsentDone();
  }, [onConsentDone]);

  if (!introDone) {
    return <IntroSequence onStart={() => setIntroDone(true)} />;
  }

  // 条款门：使用条款与隐私条款都读到最底部并同意后才放行，这一页没有跳过。
  // 它不算向导的一步，所以进度点仍从五步开始。
  if (!consented) return <ConsentStep canBackup={canBackup} onAgree={accept} />;

  const CurrentStep = wizardSteps[step];
  const capabilityStep = step === wizardSteps.length;
  return (
    <CapabilitySetup
      onDone={() => {
        markOnboardingCompleted();
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
