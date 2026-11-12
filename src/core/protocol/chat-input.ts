import { SNIFF_BYTES, formatByName, imageMimeOf, isTextContent } from './files';

// 助手 Composer 的输入模型：图文混排 blocks、附件类型与上限。
// 内联图片以 ![文件名](dela-img:<UUID>) 嵌入，发送时按出现顺序拆成 text / image blocks，附件不进入排版区。

export const INLINE_IMAGE_MAX = 6;
export const CHAT_ATTACHMENT_MAX = 5;
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 1024 * 1024;
export const CHAT_DOCUMENT_MAX_BYTES = 128 * 1024 * 1024;

// 视觉模型普遍接受的位图格式；svg 按文本附件、bmp 交给文档 skill。
const chatImageMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

type ChatBlock = { type: 'text'; text: string } | { type: 'image'; id: string; name: string };

// UUID 严格匹配主进程生成的 id，避免误吞普通 Markdown 图片链接。
const chatImageTokenRe =
  /!\[([^\]\n]*)\]\(dela-img:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

export function parseChatBlocks(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let cursor = 0;
  for (const match of matchChatImageTokens(text)) {
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ type: 'text', text: text.slice(cursor, index) });
    blocks.push({ type: 'image', id: match[2]!, name: match[1] ?? '' });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) blocks.push({ type: 'text', text: text.slice(cursor) });
  return blocks;
}

export function matchChatImageTokens(text: string): RegExpMatchArray[] {
  return [...text.matchAll(chatImageTokenRe)];
}

/** 持久化消息 content 只存纯文本。 */
export function stripChatImageTokens(text: string): string {
  return text.replace(chatImageTokenRe, '').trim();
}

export function hasChatImages(text: string): boolean {
  return text.search(chatImageTokenRe) !== -1;
}

/** 生成内联图片 token；alt 内的方括号与换行会破坏 Markdown 语法，先行清理。 */
export function chatImageToken(id: string, name: string): string {
  const alt = name.replace(/[[\]\n]/g, ' ').trim() || '图片';
  return `![${alt}](dela-img:${id})`;
}

/** 附件分流：可直接给视觉模型的位图走内联图片；PDF/Office 与无法当文本读的内容交给文档 skill；
 *  其余按文本附件。head 为文件开头字节，truncated 表示它不是整个文件。 */
export function chatFileKind(
  name: string,
  head: Uint8Array,
  truncated = false,
): 'image' | 'text' | 'document' {
  const format = formatByName(name);
  if (format === 'image' && chatImageMimes.has(imageMimeOf(name) ?? '')) return 'image';
  if (format === 'markdown') return 'text';
  if (format && format !== 'image') return 'document';
  return isTextContent(head, truncated) ? 'text' : 'document';
}

/** 浏览器 File 的附件分流：只读开头嗅探窗口，大文件不整个读进渲染进程。 */
export async function chatFileKindOfFile(file: File): Promise<'image' | 'text' | 'document'> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  return chatFileKind(file.name, head, file.size > SNIFF_BYTES);
}
