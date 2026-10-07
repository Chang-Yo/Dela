import type { AgentTool } from './shared';
import { commonTools, fileTools, shellTools } from './common';
import { webTools } from './web';

/** 能力域：设置 › 内置能力按域分组与批量启停，顺序即界面展示顺序。
 * 校园与工作区业务工具不常驻模型工具表，经 shell 的 dela 命令调用（commands.ts）。 */
export interface ToolDomain {
  id: string;
  label: string;
  tools: Record<string, AgentTool>;
}

export const toolDomains: readonly ToolDomain[] = [
  { id: 'common', label: '笔记与资料', tools: commonTools },
  { id: 'files', label: '本地文件', tools: fileTools },
  { id: 'shell', label: '命令执行', tools: shellTools },
  { id: 'web', label: '网页检索', tools: webTools },
];

export const agentTools = {
  ...commonTools,
  ...fileTools,
  ...shellTools,
  ...webTools,
};
