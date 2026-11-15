import { defineView } from '../../../app/module';
import { subscribe } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import { shuiyuanContract, shuiyuanTopicFromUrl } from '../contract';
import { ShuiyuanCredential } from './ShuiyuanCredential';
import { ShuiyuanIcon } from './shuiyuan-icon';
import { ShuiyuanOnboardingStep } from './ShuiyuanOnboardingStep';
import { ShuiyuanView } from './ShuiyuanView';
import { ShuiyuanSourceDoc, SnapshotBadge } from './SourceRefCard';
import { openTopic } from './store';
import { openPost, SOURCE_PREFIX } from './use-shuiyuan';

export const shuiyuanView = defineView({
  pages: {
    shuiyuan: {
      component: ShuiyuanView,
      nav: { label: '水源(beta)', icon: ShuiyuanIcon },
      open({ topicId, postNumber, postId }) {
        if (topicId !== undefined) openTopic(topicId, postNumber);
        else if (postId !== undefined) openPost(postId);
      },
    },
  },
  notices: { shuiyuan: { label: '水源', icon: ShuiyuanIcon } },
  settings: { credentials: ShuiyuanCredential },
  onboarding: ShuiyuanOnboardingStep,
  sources: {
    prefix: SOURCE_PREFIX,
    icon: ShuiyuanIcon,
    badge: SnapshotBadge,
    document: ShuiyuanSourceDoc,
  },
  opensLink: (url) => shuiyuanTopicFromUrl(url) !== null,
  start(navigate) {
    const bridge = window.dela?.bridge;
    // 主进程拦下的水源链接（聊天、邮件、外部唤起）。
    subscribe(shuiyuanContract, bridge, 'openTopic', ({ topicId, postNumber }) =>
      navigate({ page: 'shuiyuan', topicId, postNumber }),
    );
    subscribe(shuiyuanContract, bridge, 'snapshotEnded', ({ title, status, error }) =>
      showToast(
        status === 'done'
          ? { variant: 'success', title: '水源快照已保存', description: title }
          : {
              variant: 'error',
              title: '水源快照保存失败',
              description: `「${title}」：${error ?? '未知错误'}。可在项目中打开该帖子重试。`,
            },
      ),
    );
  },
});
