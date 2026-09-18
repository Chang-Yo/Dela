// 内联图片预览缓存：composer 暂存与历史消息共用同一 id → data URL 映射，
// 应用会话内避免重复经 IPC 拉取缩略图。

const previews = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function setChatMediaPreview(id: string, url: string | null): void {
  if (url) previews.set(id, url);
}

export function getChatMediaPreview(id: string): string | undefined {
  return previews.get(id);
}

export function ensureChatMediaPreview(id: string): Promise<string | null> {
  const cached = previews.get(id);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  if (!window.dela) return Promise.resolve(null);
  const request = window.dela.chat
    .readMediaPreview(id)
    .then((url) => {
      if (url) previews.set(id, url);
      return url;
    })
    .finally(() => {
      pending.delete(id);
    });
  pending.set(id, request);
  return request;
}
