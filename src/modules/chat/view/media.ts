// 内联图片预览同步镜像：编辑器里的 CodeMirror 图片 chip 不在 React 里，只能同步读取；
// 消息里的缩略图走 ['chat', 'media', id] 查询，拉取结果同时写回这里。
import { agentClient } from './client';

const previews = new Map<string, string>();

export function setChatMediaPreview(id: string, url: string | null): void {
  if (url) previews.set(id, url);
}

/** 释放暂存附件；失败只会留下待清理的临时文件，不打扰用户。 */
export function releaseChatMedia(ids: string[]): void {
  if (ids.length) void agentClient['release-media']({ ids }).catch(() => {});
}

export function getChatMediaPreview(id: string): string | undefined {
  return previews.get(id);
}

export async function fetchChatMediaPreview(id: string): Promise<string | null> {
  const url = await agentClient['read-media-preview']({ id });
  setChatMediaPreview(id, url);
  return url;
}
