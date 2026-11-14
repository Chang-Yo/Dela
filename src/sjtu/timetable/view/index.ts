import { CalendarDays } from 'lucide-react';
import { defineView } from '../../../app/module';
import { TimetableCredential } from './TimetableCredential';
import { TimetableOnboardingStep } from './TimetableOnboardingStep';
import { TimetableView } from './TimetableView';

export const timetableView = defineView({
  pages: { timetable: { component: TimetableView, nav: { label: '课表', icon: CalendarDays } } },
  settings: { credentials: TimetableCredential },
  onboarding: TimetableOnboardingStep,
});
