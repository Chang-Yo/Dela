import { GraduationCap } from 'lucide-react';
import { defineView } from '../../../app/module';
import { JwcNoticeView } from './JwcNoticeView';

export const jwcView = defineView({
  pages: { jwc: { component: JwcNoticeView } },
  notices: { jwc: { label: '教务处', icon: GraduationCap } },
});
