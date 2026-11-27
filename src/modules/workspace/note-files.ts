// 笔记图片引用的共享约定：主进程解析、renderer 生成展示 URL 共用。

/** Markdown 图片引用 `![alt](path "title")`；alt 与 title 内不再容忍括号换行。 */
const markdownImageRefRe = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

interface MarkdownImageRef {
  path: string;
  alt: string;
  index: number;
  length: number;
}

export function matchMarkdownImageRefs(text: string): MarkdownImageRef[] {
  return [...text.matchAll(markdownImageRefRe)].map((match) => ({
    path: match[2]!,
    alt: match[1] ?? '',
    index: match.index ?? 0,
    length: match[0].length,
  }));
}

export function isRelativeAssetPath(path: string): boolean {
  if (!path || path.startsWith('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-z]:[\\/]/i.test(path)) return false;
  return true;
}

/** 正文里的路径可能是 URI 编码的（空格写成 %20）：找磁盘文件前先解码，坏编码按原样。 */
export function decodeAssetPath(path: string): string {
  try {
    return decodeURI(path).replace(/%28/gi, '(').replace(/%29/gi, ')');
  } catch {
    return path;
  }
}

export function noteAssetUrl(entryId: string, ref: string): string {
  return `dela-resource://note-asset/${encodeURIComponent(ref)}?id=${encodeURIComponent(entryId)}`;
}
