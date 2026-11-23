// 桌面工作台的共享类型：资源地址、预览内容与标签标识，app 与各模块共用。
import type { FileFormat } from './files';

/** 资源地址：Agent 与界面指代一份资料的方式；type 由登记它的模块解释，其余字段也由它校验。 */
export interface ResourceAddress {
  type: string;
  [field: string]: unknown;
}

export interface DocumentContent {
  title: string;
  /** html 只来自模块登记的资料；工作区与远端文件按 FileFormat 分类。 */
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
}

export const tabKinds = ['chat', 'note', 'preview', 'review', 'terminal'] as const;
export type TabKind = (typeof tabKinds)[number];
/** chat:{sessionId} | note:{entryId} | preview:{sourceKey|entryId} | review:{...} | terminal:{projectId} */
export type TabId = `${TabKind}:${string}`;
