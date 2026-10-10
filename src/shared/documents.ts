import type { ResourceRef } from './resources';
import { textFileExtensions } from './chat-input';

const markdownExtensions = ['.md', '.markdown'];
const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const officeExtensions: Record<string, 'docx' | 'xlsx' | 'pptx'> = {
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
};

/** 取扩展名（小写，含点）。纯字符串实现：渲染端也要用，不能引 node:path。 */
function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** 按名字判定文档格式：本地条目与远端文件共用同一套规则（远端没有宿主 extname 可用）。 */
export function documentFormatOf(name: string): DocumentContent['format'] {
  const ext = extensionOf(name);
  if (ext === '.pdf') return 'pdf';
  if (imageExtensions.includes(ext)) return 'image';
  if (markdownExtensions.includes(ext)) return 'markdown';
  if (textFileExtensions.includes(ext.slice(1))) return 'text';
  return officeExtensions[ext] ?? 'unsupported';
}

export interface DocumentContent {
  title: string;
  format: 'html' | 'markdown' | 'text' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'unsupported';
  text?: string;
  bytes?: Uint8Array;
  previewUrl?: string;
  mime?: string;
  url?: string;
  dueAt?: string | null;
  updatedAt?: string | null;
  revision?: string;
  /** pptx 的导出关联；存在 export 时直接内嵌渲染导出的 PDF。 */
  office?: { export?: OfficeExportInfo };
}

/** 已导出 PDF 与源 pptx 的关联信息；stale 表示源文件在导出后更新过。 */
export interface OfficeExportInfo {
  previewUrl: string;
  title: string;
  stale: boolean;
}

/** pptx 导出过程阶段；bytes 为输出 PDF 已写入的字节数（仅 writing 阶段）。 */
export interface OfficeExportProgress {
  phase: 'preparing' | 'converting' | 'writing';
  bytes?: number;
}

/** 进度事件载荷：附带上报时定位用的资源引用，并发导出时可区分归属。 */
export interface OfficeExportEvent extends OfficeExportProgress {
  ref: ResourceRef;
}
