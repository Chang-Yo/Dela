import type { ResourceRef } from './resources';
import type { FileFormat } from './files';

export interface DocumentContent {
  title: string;
  /** html 只来自 Canvas 页面与水源；工作区与远端文件按 FileFormat 分类。 */
  format: FileFormat | 'html';
  text?: string;
  /** 文本只读：超过编辑上限、或来自远端项目。truncated 表示 text 只是文件开头。 */
  readOnly?: boolean;
  truncated?: boolean;
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
