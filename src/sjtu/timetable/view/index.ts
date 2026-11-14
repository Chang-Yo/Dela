import { defineView } from '../../../app/module';
import { TimetableCredential } from './TimetableCredential';
import { TimetableOnboardingStep } from './TimetableOnboardingStep';
import { TimetableView } from './TimetableView';

export const timetableView = defineView({
  pages: { timetable: { component: TimetableView } },
  settings: { credentials: TimetableCredential },
  onboarding: TimetableOnboardingStep,
});
