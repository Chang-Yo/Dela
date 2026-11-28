import { Globe } from 'lucide-react';
import { defineView } from '../../../app/module';
import { WEBSITE_NOTICE_SOURCE } from '../contract';
import { WebsiteSubscriptionsPanel } from './WebsiteSubscriptionsPanel';
import { WebsiteSubscriptionsSetting } from './WebsiteSubscriptionsSetting';

export const websiteSubscriptionsView = defineView({
  pages: {},
  notices: {
    [WEBSITE_NOTICE_SOURCE]: {
      label: '官网公告',
      icon: Globe,
      subscriptions: WebsiteSubscriptionsPanel,
    },
  },
  settings: { notifications: WebsiteSubscriptionsSetting },
});
