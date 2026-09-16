import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { checkWorkspaceSender } from '../ipc';
import {
  addShuiyuanSourceRef,
  bindShuiyuan,
  createShuiyuanMessage,
  createShuiyuanReply,
  createShuiyuanUpload,
  getShuiyuanCounts,
  getShuiyuanSiteStructure,
  getShuiyuanSourceRef,
  getShuiyuanState,
  getShuiyuanTopic,
  listShuiyuanBookmarks,
  listShuiyuanMessages,
  listShuiyuanNotifications,
  listShuiyuanTopics,
  loadShuiyuanPosts,
  markShuiyuanNotificationsRead,
  readShuiyuanSource,
  setShuiyuanBookmarked,
  startShuiyuanAuth,
  unbindShuiyuan,
} from './api';

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
  handle('add-source-ref', (_event, topicId: unknown) => addShuiyuanSourceRef(topicId));
  handle('get-source-ref', (_event, topicId: unknown) => getShuiyuanSourceRef(topicId));
  handle('read-source', (_event, topicId: unknown) => readShuiyuanSource(topicId));
}
