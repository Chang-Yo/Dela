// 笔记图片引用与外部打开的共享约定：主进程解析、renderer 生成展示 URL 与按钮分流共用。
import { textFileExtensions } from './chat-input';

/** Markdown 图片引用 `![alt](path "title")`；alt 与 title 内不再容忍括号换行。 */
const markdownImageRefRe = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export interface MarkdownImageRef {
  /** 括号内的原始路径（未解码）。 */
  path: string;
  /** alt 文本。 */
  alt: string;
  /** 整段引用的起始偏移。 */
  index: number;
  /** 整段引用长度。 */
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

/** 重建一段图片引用；路径内空格与括号需编码（encodeURIComponent 不含括号），避免破坏 Markdown 语法。 */
export function buildMarkdownImage(alt: string, path: string): string {
  const encoded = path.replaceAll(/[()\s]/g, (ch) =>
    ch === '(' ? '%28' : ch === ')' ? '%29' : encodeURIComponent(ch)!,
  );
  return `![${alt.replace(/[[\]\n]/g, ' ')}](${encoded})`;
}

/** 相对资源路径：无协议、非站内锚点、非绝对路径或 Windows 盘符。 */
export function isRelativeAssetPath(path: string): boolean {
  if (!path || path.startsWith('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-z]:[\\/]/i.test(path)) return false;
  return true;
}

/** 受限资源协议下的图片展示地址；协议按条目 ID 解析实际文件，不暴露磁盘路径。 */
export function noteAssetUrl(entryId: string, ref: string): string {
  return `dela-resource://note-asset/${encodeURIComponent(ref)}?id=${encodeURIComponent(entryId)}`;
}

/** 外部打开入口分流：文本/代码文件进 VS Code，Markdown 笔记与 PDF、图片等交给系统默认应用。 */
export function externalOpenTarget(filename: string): 'vscode' | 'system' {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  if (!ext || ext === filename.toLowerCase()) return 'system';
  if (ext === 'md' || ext === 'markdown') return 'system';
  return textFileExtensions.includes(ext) ? 'vscode' : 'system';
}

/* 所见即所得内核会破坏 frontmatter（分隔线 + setext 标题化）。识别到 frontmatter 的
   文档整篇进入源码模式，其他范围外语法（原始 HTML、脚注、指令块）经实测可原样保留。 */
const frontmatterRe = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function markdownRequiresSourceMode(text: string): boolean {
  return frontmatterRe.test(text);
}
