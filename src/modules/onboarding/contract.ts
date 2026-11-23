import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export interface OnboardingState {
  consented: boolean;
  /** 首启向导走完过：只缺条款的老用户补完条款即进入应用。 */
  completed: boolean;
}

export const onboardingContract = defineContract('onboarding', {
  state: { input: z.undefined(), output: z.custom<OnboardingState>() },
  complete: { input: z.undefined(), output: z.void() },
  installMagpiePlugin: { input: z.undefined(), output: z.boolean() },
});
