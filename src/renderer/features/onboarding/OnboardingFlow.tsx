import { useCallback, useState } from 'react';
import { CampusStep } from './steps/CampusStep';
import { CanvasStep } from './steps/CanvasStep';
import { LlmStep } from './steps/LlmStep';
import { MailStep } from './steps/MailStep';
import { ShuiyuanStep } from './steps/ShuiyuanStep';
import { ConsentStep } from './ConsentStep';
import { IntroSequence } from './IntroSequence';
import { WizardShell } from './WizardShell';
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
  /** 走完配置向导（配置完成或全部跳过）后回调；宿主挂载主界面并叠加完成动画。 */
  onWizardDone: () => void;
  /** 老用户只补一次条款同意：不走向导，也不播完成动画，直接进主界面。 */
  onConsentDone: () => void;
};

/**
 * 首次启动引导：Intro 动画（视频/品牌/Quote）→ 条款接受 → 五步配置向导。
 * 老用户（本次启动前就在用 Dela）只过条款接受这一页，同意完直接进主界面。
 * 完成动画由宿主在主界面之上渲染（CompletionOverlay），不属于本组件。
 */
export function OnboardingFlow({ onConsentDone, onWizardDone }: OnboardingFlowProps) {
  // 启动时是否跳过整个引导由 App 判定；这里仅管理当前流程内的步骤。
  // 老用户不放开场动画（进过向导的也算老用户，由 needsWizard 一并判定）。
  const [introDone, setIntroDone] = useState(() => !needsWizard());
  // 钳制到合法区间，防御被手工改坏的 localStorage 值。
  const [step, setStep] = useState(() => Math.min(readWizardStep() ?? 0, wizardSteps.length - 1));
  const [consented, setConsented] = useState(hasConsent);
  // 只有已经有本机数据的安装才需要「导出本机数据」这个出口，全新安装没有可导出的东西。
  const [canBackup] = useState(() => !needsWizard());

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

  const back = useCallback(() => {
    if (step === 0) return;
    saveWizardStep(step - 1);
    setStep(step - 1);
  }, [step]);

  const accept = useCallback(() => {
    saveConsent();
    // 老用户补完同意就结束引导：没有向导要跑，也没有「配置完成」可庆祝。
    if (needsWizard()) setConsented(true);
    else onConsentDone();
  }, [onConsentDone]);

  if (!introDone) {
    return <IntroSequence onStart={() => setIntroDone(true)} />;
  }

  // 条款门：使用条款与隐私条款都读到最底部并同意后才放行，这一页没有跳过。
  // 它不算向导的一步，所以进度点仍从五步开始。
  if (!consented) return <ConsentStep canBackup={canBackup} onAgree={accept} />;

  const CurrentStep = wizardSteps[step]!;
  return (
    <WizardShell
      onBack={step > 0 ? back : undefined}
      onSkip={advance}
      step={step}
      stepCount={wizardSteps.length}
    >
      <CurrentStep onDone={advance} />
    </WizardShell>
  );
}
