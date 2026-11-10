import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { checkWorkspaceSender } from '../ipc';
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
} from './api';
import { refreshShuiyuanSnapshot } from './snapshot';
import {
  addShuiyuanSourceRef,
  getShuiyuanSourceRef,
  readShuiyuanSourcePreview,
  readShuiyuanSourcePage,
  shuiyuanTopicUrl,
} from './sources';

export function registerShuiyuanIpc(): void {
  const handle = (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    ipcMain.handle(`shuiyuan:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(event, ...args);
    });
  handle('get-state', () => getShuiyuanState());
  handle('start-auth', (event) => startShuiyuanAuth(event.sender));
  handle('bind', (_event, payload: unknown) => bindShuiyuan(payload));
  handle('unbind', () => unbindShuiyuan());
  handle('site-structure', () => getShuiyuanSiteStructure());
  handle('list-topics', (_event, feed: unknown, moreUrl?: unknown) =>
    listShuiyuanTopics(feed, moreUrl),
  );
  handle('get-topic', (_event, id: unknown, postNumber?: unknown) =>
    getShuiyuanTopic(id, postNumber),
  );
  handle('load-posts', (_event, topicId: unknown, postIds: unknown) =>
    loadShuiyuanPosts(topicId, postIds),
  );
  handle('locate-post', (_event, postId: unknown) => locateShuiyuanPost(postId));
  handle('list-bookmarks', () => listShuiyuanBookmarks());
  handle('list-messages', () => listShuiyuanMessages());
  handle('list-notifications', () => listShuiyuanNotifications());
  handle('mark-notifications-read', () => markShuiyuanNotificationsRead());
  handle('get-counts', () => getShuiyuanCounts());
  handle('create-reply', (_event, topicId: unknown, raw: unknown, replyToPostNumber?: unknown) =>
    createShuiyuanReply(topicId, raw, replyToPostNumber),
  );
  handle('upload-file', (_event, fileName: unknown, base64: unknown) =>
    createShuiyuanUpload(fileName, base64),
  );
  handle('create-message', (_event, to: unknown, title: unknown, raw: unknown) =>
    createShuiyuanMessage(to, title, raw),
  );
  handle('set-bookmarked', (_event, topicId: unknown, on: unknown) =>
    setShuiyuanBookmarked(topicId, on),
  );
  handle('set-liked', (_event, postId: unknown, liked: unknown) => setShuiyuanLiked(postId, liked));
  handle('add-source-ref', (_event, topicId: unknown) => addShuiyuanSourceRef(topicId));
  handle('get-source-ref', (_event, topicId: unknown) => getShuiyuanSourceRef(topicId));
  handle('read-source', (_event, topicId: unknown) => readShuiyuanSourcePreview(topicId));
  handle('read-snapshot-page', (_event, topicId: unknown, page: unknown) =>
    readShuiyuanSourcePage(topicId, page),
  );
  handle('refresh-snapshot', (_event, topicId: unknown) => refreshShuiyuanSnapshot(topicId));
  handle('open-in-browser', (_event, topicId: unknown) =>
    shell.openExternal(shuiyuanTopicUrl(topicId)),
  );
}
