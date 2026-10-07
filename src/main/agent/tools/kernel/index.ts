import type { AgentTool } from '../shared';
import { bashTool } from './bash';
import { editTool } from './edit';
import { globTool } from './glob';
import { grepTool } from './grep';
import { readTool } from './read';
import { readSkillsTool } from './skills';
import { webFetchTool } from './webfetch';
import { webSearchTool } from './websearch';
import { writeTool } from './write';

/** 内核工具（冻结）：九个无领域原语。领域知识在 skills 与 dela 命令，不进内核。
 * 校园与工作区业务命令经 Bash 的 dela <命令> 调用（commands.ts）。 */
export const kernelTools = {
  Read: readTool,
  Write: writeTool,
  Edit: editTool,
  Grep: grepTool,
  Glob: globTool,
  Bash: bashTool,
  WebFetch: webFetchTool,
  WebSearch: webSearchTool,
  ReadSkills: readSkillsTool,
};

export interface ToolDomain {
  id: string;
  label: string;
  tools: Record<string, AgentTool>;
}

/** 能力域：设置 › 内置能力按域分组与批量启停，顺序即界面展示顺序。 */
export const toolDomains: readonly ToolDomain[] = [
  {
    id: 'core',
    label: '基础',
    tools: {
      Read: kernelTools.Read,
      Write: kernelTools.Write,
      Edit: kernelTools.Edit,
      Grep: kernelTools.Grep,
      Glob: kernelTools.Glob,
      Bash: kernelTools.Bash,
      ReadSkills: kernelTools.ReadSkills,
    },
  },
  {
    id: 'web',
    label: '网络',
    tools: { WebFetch: kernelTools.WebFetch, WebSearch: kernelTools.WebSearch },
  },
];

export const agentTools = {
  ...kernelTools,
};
