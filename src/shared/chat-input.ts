// 助手 Composer 的输入模型：图文混排 blocks、附件类型与上限。
// 内联图片以 Markdown 图片语法嵌入文本：![文件名](dela-img:<UUID>)，
// 发送时按出现顺序拆成 text / image blocks 交给模型，附件不进入排版区。

export const INLINE_IMAGE_MAX = 6;
export const CHAT_ATTACHMENT_MAX = 5;
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 1024 * 1024;

export const imageFileExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

// 与工作区文本预览共用同一份扩展名清单（无点小写）。
export const textFileExtensions = [
  'md',
  'markdown',
  'txt',
  'text',
  'log',
  'csv',
  'tsv',
  'json',
  'jsonc',
  'xml',
  'svg',
  'yml',
  'yaml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'properties',
  'env',
  'editorconfig',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'pyw',
  'ipynb',
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
  'java',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'kt',
  'kts',
  'scala',
  'dart',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'bat',
  'cmd',
  'sql',
  'r',
  'pl',
  'lua',
  'tex',
  'rst',
  'mk',
  'cmake',
  'gradle',
];

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

/** 文档中全部内联图片 token（matchAll 结果）。 */
export function matchChatImageTokens(text: string): RegExpMatchArray[] {
  return [...text.matchAll(chatImageTokenRe)];
}

/** 去掉内联图片 token，保留纯文本（持久化消息 content 用）。 */
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

export function chatFileKind(name: string): 'image' | 'text' | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (!ext || ext === name.toLowerCase()) return null;
  if (imageFileExtensions.includes(ext)) return 'image';
  if (textFileExtensions.includes(ext)) return 'text';
  return null;
}
