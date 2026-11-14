import { Mail } from 'lucide-react';
import { defineView } from '../../../app/module';
import { MailCredential } from './MailCredential';
import { MailOnboardingStep } from './MailOnboardingStep';
import { MailStorage } from './MailStorage';
import { MailPage } from './MailView';

export { leaveComposer, registerComposeSave, saveComposers } from './compose-close';
export { MailDraftDialog } from './MailDraftDialog';
export { renderMailHtml } from './mail-html-display';

export const mailView = defineView({
  pages: { mail: { component: MailPage, nav: { label: '邮箱', icon: Mail } } },
  notices: { mail: { label: '邮件', icon: Mail } },
  settings: { credentials: MailCredential, storage: MailStorage },
  onboarding: MailOnboardingStep,
});
