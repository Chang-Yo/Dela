import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { publishNotificationState, registerNoticeSource } from '../../modules/notifications';
import { registerSettingsSearch } from '../../modules/settings';
import { WEBSITE_SUBSCRIPTIONS_SETTING, websiteSubscriptionsContract } from './contract';
import {
  addNoticeSubscription,
  listNoticeSubscriptions,
  noticeSubscriptionsEnabled,
  previewNoticeSubscription,
  removeNoticeSubscription,
  setNoticeSubscriptionsEnabled,
  websiteNoticeSource,
} from './main/notices';

export const websiteSubscriptionsModule = defineModule({
  id: 'websiteSubscriptions',
  ipc: implement(websiteSubscriptionsContract, {
    subscriptions: () => {
      const experimental = noticeSubscriptionsEnabled();
      return { experimental, notices: experimental ? listNoticeSubscriptions() : [] };
    },
    setNoticeSubscriptionsEnabled: (enabled) => {
      setNoticeSubscriptionsEnabled(enabled);
      return publishNotificationState();
    },
    previewNoticeSubscription: ({ url, sampleTitle, render }) =>
      previewNoticeSubscription(url, sampleTitle, render),
    addNoticeSubscription: ({ token, candidate }) => {
      addNoticeSubscription(token, candidate);
      return publishNotificationState();
    },
    removeNoticeSubscription: (id) => {
      removeNoticeSubscription(id);
      return publishNotificationState();
    },
  }),
  register() {
    registerNoticeSource(websiteNoticeSource);
    registerSettingsSearch({
      id: WEBSITE_SUBSCRIPTIONS_SETTING,
      section: 'notifications',
      title: '通用公告订阅',
      keywords: ['试验功能', '官网公告', 'RSS', 'Atom', '订阅'],
    });
  },
});
