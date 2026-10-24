import type { ShuiyuanApi, ShuiyuanFeed, ShuiyuanTopicLink } from '../shared/api';
import { invoke, on } from './lib';

export const shuiyuan = {
  getState: () => invoke('shuiyuan:get-state'),
  startAuth: () => invoke('shuiyuan:start-auth'),
  bind: (payload: string) => invoke('shuiyuan:bind', payload),
  unbind: () => invoke('shuiyuan:unbind'),
  siteStructure: () => invoke('shuiyuan:site-structure'),
  listTopics: (feed: ShuiyuanFeed, moreUrl?: string) =>
    invoke('shuiyuan:list-topics', feed, moreUrl),
  getTopic: (id: number, postNumber?: number) => invoke('shuiyuan:get-topic', id, postNumber),
  loadPosts: (topicId: number, postIds: readonly number[]) =>
    invoke('shuiyuan:load-posts', topicId, [...postIds]),
  listBookmarks: () => invoke('shuiyuan:list-bookmarks'),
  listMessages: () => invoke('shuiyuan:list-messages'),
  listNotifications: () => invoke('shuiyuan:list-notifications'),
  markNotificationsRead: () => invoke('shuiyuan:mark-notifications-read'),
  getCounts: () => invoke('shuiyuan:get-counts'),
  createReply: (topicId: number, raw: string, replyToPostNumber?: number) =>
    invoke('shuiyuan:create-reply', topicId, raw, replyToPostNumber),
  uploadFile: (fileName: string, base64: string) =>
    invoke('shuiyuan:upload-file', fileName, base64),
  createMessage: (to: readonly string[], title: string, raw: string) =>
    invoke('shuiyuan:create-message', [...to], title, raw),
  setBookmarked: (topicId: number, on: boolean) => invoke('shuiyuan:set-bookmarked', topicId, on),
  setLiked: (postId: number, liked: boolean) => invoke('shuiyuan:set-liked', postId, liked),
  addSourceRef: (topicId: number) => invoke('shuiyuan:add-source-ref', topicId),
  getSourceRef: (topicId: number) => invoke('shuiyuan:get-source-ref', topicId),
  readSource: (topicId: number) => invoke('shuiyuan:read-source', topicId),
  openInBrowser: (topicId: number) => invoke('shuiyuan:open-in-browser', topicId),
  onOpenTopic: (listener: (target: ShuiyuanTopicLink) => void) =>
    on<ShuiyuanTopicLink>('shuiyuan:open-topic', listener),
} satisfies ShuiyuanApi;
