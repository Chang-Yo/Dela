// 水源社区：阅读、通知与帖子快照；水源链接在应用内打开。
import { shell, type WebContents } from 'electron';
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { registerResourceResolver } from '../../core/capabilities/resources';
import { hostPorts, registerSecretLabel } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { registerNoticeSource } from '../../modules/notifications';
import {
  excludeFromBackup,
  registerCacheDirectory,
  registerSettingsSearch,
} from '../../modules/settings';
import { registerPreviewHost, registerWorkspaceSource } from '../../modules/workspace';
import { shuiyuanContract } from './contract';
import { shuiyuanSchema } from './data/schema';
import { shuiyuanDomain } from './main/agent';
import {
  bindShuiyuan,
  createShuiyuanMessage,
  createShuiyuanReply,
  createShuiyuanUpload,
  getShuiyuanCounts,
  getShuiyuanSiteStructure,
  getShuiyuanState,
  getShuiyuanTopic,
  listShuiyuanBookmarks,
  listShuiyuanMessages,
  listShuiyuanNotifications,
  listShuiyuanTopics,
  loadShuiyuanPosts,
  locateShuiyuanPost,
  markShuiyuanNotificationsRead,
  setShuiyuanBookmarked,
  setShuiyuanLiked,
  startShuiyuanAuth,
  unbindShuiyuan,
} from './main/api';
import { openShuiyuanLinkInApp } from './main/links';
import { handleShuiyuanMediaRequest } from './main/media';
import { shuiyuanNoticeSource } from './main/notice-source';
import { shuiyuanOnlineResourceResolver, shuiyuanWorkspaceSource } from './main/resources';
import { refreshShuiyuanSnapshot, resumeShuiyuanSnapshots } from './main/snapshot';
import { handleShuiyuanSnapshotRequest, snapshotDirectoryName } from './main/snapshot-files';
import {
  addShuiyuanSourceRef,
  getShuiyuanSourceRef,
  readShuiyuanSnapshotPostCount,
  readShuiyuanSourcePage,
  shuiyuanTopicUrl,
} from './main/sources';

export const shuiyuanModule = defineModule({
  id: 'shuiyuan',
  schema: shuiyuanSchema,
  ipc: implement(shuiyuanContract, {
    state: () => getShuiyuanState(),
    startAuth: () => startShuiyuanAuth(hostPorts().workspaceClient() as WebContents),
    bind: (payload) => bindShuiyuan(payload),
    unbind: () => unbindShuiyuan(),
    siteStructure: () => getShuiyuanSiteStructure(),
    topics: ({ feed, moreUrl }) => listShuiyuanTopics(feed, moreUrl),
    topic: ({ id, postNumber }) => getShuiyuanTopic(id, postNumber),
    posts: ({ topicId, postIds }) => loadShuiyuanPosts(topicId, postIds),
    locatePost: (postId) => locateShuiyuanPost(postId),
    bookmarks: () => listShuiyuanBookmarks(),
    messages: () => listShuiyuanMessages(),
    notifications: () => listShuiyuanNotifications(),
    markNotificationsRead: () => markShuiyuanNotificationsRead(),
    counts: () => getShuiyuanCounts(),
    reply: ({ topicId, raw, replyToPostNumber }) =>
      createShuiyuanReply(topicId, raw, replyToPostNumber),
    upload: ({ fileName, base64 }) => createShuiyuanUpload(fileName, base64),
    message: ({ to, title, raw }) => createShuiyuanMessage(to, title, raw),
    setBookmarked: ({ topicId, on }) => setShuiyuanBookmarked(topicId, on),
    setLiked: ({ postId, liked }) => setShuiyuanLiked(postId, liked),
    addSourceRef: (topicId) => addShuiyuanSourceRef(topicId),
    sourceRef: (topicId) => getShuiyuanSourceRef(topicId),
    snapshotPage: ({ topicId, page }) => readShuiyuanSourcePage(topicId, page),
    snapshotPostCount: (topicId) => readShuiyuanSnapshotPostCount(topicId),
    refreshSnapshot: (topicId) => refreshShuiyuanSnapshot(topicId),
    openInBrowser: (topicId) => shell.openExternal(shuiyuanTopicUrl(topicId)),
  }),
  register() {
    registerSettingsSearch({
      id: 'shuiyuan',
      section: 'connections',
      title: '水源社区',
      keywords: ['连接', '水源', '社区', '论坛', 'shuiyuan'],
    });
    registerSecretLabel('shuiyuan-key', '水源凭据');
    registerCommandDomain(shuiyuanDomain);
    registerNoticeSource(shuiyuanNoticeSource);
    registerWorkspaceSource(shuiyuanWorkspaceSource);
    registerResourceResolver('shuiyuan-online', shuiyuanOnlineResourceResolver);
    registerPreviewHost('shuiyuan', handleShuiyuanMediaRequest);
    registerPreviewHost('shuiyuan-snapshot', (_request, url) => handleShuiyuanSnapshotRequest(url));
    // 备份只保留水源引用；快照和本机密钥不导出，恢复后尝试重新保存。
    excludeFromBackup(snapshotDirectoryName);
    registerCacheDirectory(new RegExp(`^${snapshotDirectoryName}/\\d+(?:\\.partial)?/thumbnails$`));
  },
  start() {
    void resumeShuiyuanSnapshots().catch((error: unknown) =>
      console.error('Shuiyuan snapshot resume failed', error),
    );
  },
  openLink: openShuiyuanLinkInApp,
});
