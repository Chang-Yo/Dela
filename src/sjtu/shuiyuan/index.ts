// 水源社区：阅读、通知与帖子快照；水源链接在应用内打开。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { registerResourceResolver } from '../../core/capabilities/resources';
import { registerSecretLabel } from '../../core/ports';
import { registerNoticeSource } from '../../main/notifications';
import { registerPreviewHost } from '../../main/workspace/preview';
import { registerWorkspaceSource } from '../../main/workspace/sources';
import { shuiyuanDomain } from './main/agent';
import { registerShuiyuanIpc } from './main/ipc';
import { openShuiyuanLinkInApp } from './main/links';
import { handleShuiyuanMediaRequest } from './main/media';
import { shuiyuanNoticeSource } from './main/notice-source';
import { shuiyuanOnlineResourceResolver, shuiyuanWorkspaceSource } from './main/resources';
import { resumeShuiyuanSnapshots } from './main/snapshot';
import { handleShuiyuanSnapshotRequest } from './main/snapshot-files';

export const shuiyuanModule = defineModule({
  id: 'shuiyuan',
  register() {
    registerSecretLabel('shuiyuan-key', '水源凭据');
    registerShuiyuanIpc();
    registerCommandDomain(shuiyuanDomain);
    registerNoticeSource(shuiyuanNoticeSource);
    registerWorkspaceSource(shuiyuanWorkspaceSource);
    registerResourceResolver('shuiyuan-online', shuiyuanOnlineResourceResolver);
    registerPreviewHost('shuiyuan', handleShuiyuanMediaRequest);
    registerPreviewHost('shuiyuan-snapshot', (_request, url) => handleShuiyuanSnapshotRequest(url));
  },
  start() {
    void resumeShuiyuanSnapshots().catch((error: unknown) =>
      console.error('Shuiyuan snapshot resume failed', error),
    );
  },
  openLink: openShuiyuanLinkInApp,
});
