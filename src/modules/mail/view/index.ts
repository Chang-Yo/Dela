import { Mail } from 'lucide-react';
import { defineView } from '../../../app/module';
import { MailCredential } from './MailCredential';
import { MailOnboardingStep } from './MailOnboardingStep';
import { MailStorage } from './MailStorage';
import { MailPage } from './MailView';
import { leaveComposer } from './compose-close';

export { leaveComposer, registerComposeSave, saveComposers } from './compose-close';
export { MailDraftDialog } from './MailDraftDialog';
export {
  frameHeightFromEvent,
  frameImageFromEvent,
  frameLinkFromEvent,
  injectFrameHeightReport,
} from './frame-height';
export { renderMailHtml } from './mail-html-display';
export { sanitizeHtml } from './sanitize-html';

export const mailView = defineView({
  pages: {
    mail: { component: MailPage, nav: { label: '邮箱', icon: Mail }, drawer: true },
  },
  notices: { mail: { label: '邮件', icon: Mail } },
  settings: { credentials: MailCredential, storage: MailStorage },
  onboarding: MailOnboardingStep,
  leaveGuard: leaveComposer,
});
