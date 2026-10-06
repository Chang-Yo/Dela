/** preview:{entryId}（工作区条目）或 preview:source:{原 documentKey}（@ 引用型资料）。 */
export type PreviewTabTarget = { entryId: string } | { sourceId: string };

/** 解析预览标签键；载荷为空或 kind 不符时返回 null。 */
export function parsePreviewTabId(tabId: string): PreviewTabTarget | null {
  if (!tabId.startsWith('preview:')) return null;
  const payload = tabId.slice('preview:'.length);
  if (payload.startsWith('source:')) {
    const sourceId = payload.slice('source:'.length);
    return sourceId ? { sourceId } : null;
  }
  return payload ? { entryId: payload } : null;
}
