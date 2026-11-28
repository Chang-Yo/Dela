// 文件的唯一分类规则（本地、远端、Agent 读取与聊天附件共用）：扩展名只挑专用查看器，其余看内容而非白名单。
// 纯字符串/字节实现：renderer 也要用，不能引 node:path / Buffer。

export type FileFormat =
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'image'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'binary';

export const TEXT_EDIT_MAX_BYTES = 1024 * 1024;
export const TEXT_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
export const SNIFF_BYTES = 8000;

const imageMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

const byExtension: Record<string, FileFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
  // svg 是文本，但用户打开它几乎总是想看图；图片插入与资源协议也按图片处理。
  ...Object.fromEntries(Object.keys(imageMime).map((ext) => [ext, 'image' as const])),
};

export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function imageMimeOf(name: string): string | undefined {
  return imageMime[extensionOf(name)];
}

export function formatByName(name: string): FileFormat | null {
  return byExtension[extensionOf(name)] ?? null;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** 内容是否为可编辑文本：无 NUL 且合法 UTF-8。GBK 等非 UTF-8 文本按二进制处理，免得读进来再写回写坏；
 *  truncated 时末尾可能切断多字节字符，不参与校验。 */
export function isTextContent(head: Uint8Array, truncated = false): boolean {
  const window = head.subarray(0, SNIFF_BYTES);
  if (window.includes(0)) return false;
  let end = head.length;
  if (truncated) {
    let back = 0;
    while (back < 3 && end - back > 0 && (head[end - back - 1]! & 0xc0) === 0x80) back += 1;
    const lead = head[end - back - 1];
    if (lead !== undefined && lead >= 0xc0) end -= back + 1;
  }
  try {
    utf8.decode(head.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/** 打开方式只凭名字决定（渲染端拿不到字节）：专用查看器格式走预览，其余进文本编辑器，内容是二进制时由编辑器提示。 */
export function opensInEditor(name: string): boolean {
  const format = formatByName(name);
  return format === null || format === 'markdown';
}

export function fileFormatOf(name: string, head: Uint8Array, truncated = false): FileFormat {
  return formatByName(name) ?? (isTextContent(head, truncated) ? 'text' : 'binary');
}
