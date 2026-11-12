// 文档读取注册表：PDF、Office 的解析组件由文档模块注册；没有注册时不接收文档附件，也不保存网页 PDF。

export interface PreparedDocument {
  jobId: string;
  python: string;
  script: string;
  input: string;
  output: string;
}

export interface DocumentReader {
  /** 教 Agent 读文档的内置 Skill；组件就绪前保持停用。 */
  skill: string;
  dependency(): SkillDependency;
  /** 启用 Skill 前确认组件能运行。 */
  verify(): Promise<void>;
  /** 建临时任务目录，原文件由 writeInput 写入。 */
  prepare(writeInput: (path: string) => Promise<void>): Promise<PreparedDocument>;
}

let reader: DocumentReader | null = null;

export function registerDocumentReader(next: DocumentReader): void {
  reader = next;
}

export function documentReader(): DocumentReader | null {
  return reader;
}

export function readyDocumentReader(): DocumentReader {
  const current = reader;
  if (current?.dependency().status !== 'ready')
    throw new Error('请先在设置 › Skills 安装文档读取组件');
  return current;
}
import type { SkillDependency } from '../protocol/capabilities';
