import { createClient } from '../../../core/protocol/contract';
import { onboardingContract } from '../contract';

const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const onboardingClient = createClient(onboardingContract, bridge);
