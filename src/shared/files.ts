// 文件的唯一分类规则：本地工作区、远端项目、Agent 资源读取与聊天附件共用。
// 扩展名只用来挑「专用查看器」（PDF、图片、Office、Markdown）；其余一律看内容——
// 文本与否由字节决定，而不是由一份永远列不全的扩展名白名单决定（.env、Makefile、无后缀日志）。
// 纯字符串/字节实现：renderer 也要用，不能引 node:path / Buffer。

export type FileFormat =
  'markdown' | 'text' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'binary';

/** 编辑上限（与 GitHub 网页端不再渲染的阈值同量级）：再大的文本交给外部编辑器更合适。 */
export const TEXT_EDIT_MAX_BYTES = 1024 * 1024;
/** 只读预览上限：超过编辑上限的文本只读头部这么多字节；更大的文件不读内容。 */
export const TEXT_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
/** 嗅探窗口：与 Git 判定二进制时检查的前 8000 字节一致。 */
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

/** 取扩展名（小写，含点）；`.env` 这类点开头的文件名没有扩展名。 */
export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function imageMimeOf(name: string): string | undefined {
  return imageMime[extensionOf(name)];
}

/** 只凭名字能确定的专用格式；返回 null 表示要看内容才知道是文本还是二进制。 */
export function formatByName(name: string): FileFormat | null {
  return byExtension[extensionOf(name)] ?? null;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** 内容是否为可编辑文本：窗口内无 NUL 且是合法 UTF-8。
 *  非 UTF-8 文本（GBK 的 txt/csv）按二进制处理：宁可不打开，也不能按 UTF-8 读进来再写回把它写坏。
 *  truncated 表示 head 只是文件开头，末尾可能切断一个多字节字符，那几个字节不参与校验。 */
export function isTextContent(head: Uint8Array, truncated = false): boolean {
  const window = head.subarray(0, SNIFF_BYTES);
  if (window.includes(0)) return false;
  let end = head.length;
  if (truncated) {
    // 回退到最后一个完整字符的边界：续字节形如 10xxxxxx，最多回退 3 个。
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

/** 打开方式只凭名字决定（渲染端拿不到字节）：专用查看器格式走预览，其余都进文本编辑器——
 *  内容其实是二进制时，编辑器标签显示「用外部程序打开」，而不是先挡在门外。 */
export function opensInEditor(name: string): boolean {
  const format = formatByName(name);
  return format === null || format === 'markdown';
}

/** 名字 + 内容开头 → 格式。head 传读取到的字节（不必是整个文件）。 */
export function fileFormatOf(name: string, head: Uint8Array, truncated = false): FileFormat {
  return formatByName(name) ?? (isTextContent(head, truncated) ? 'text' : 'binary');
}
