import type { AgentTool } from './shared';
import { canvasTools } from './canvas';
import { commonTools } from './common';
import { mailTools } from './mail';
import { shuiyuanTools } from './shuiyuan';
import { timetableTools } from './timetable';
import { todoTools } from './todo';
import { webTools } from './web';
import { workspaceTools } from './workspace';

/** 能力域：设置 › 内置能力按域分组与批量启停，顺序即界面展示顺序。 */
export interface ToolDomain {
  id: string;
  label: string;
  tools: Record<string, AgentTool>;
}

export const toolDomains: readonly ToolDomain[] = [
  { id: 'workspace', label: '项目与文件', tools: workspaceTools },
  { id: 'common', label: '笔记与资料', tools: commonTools },
  { id: 'canvas', label: 'Canvas 课程', tools: canvasTools },
  { id: 'todo', label: '待办与作业', tools: todoTools },
  { id: 'timetable', label: '课表与日程', tools: timetableTools },
  { id: 'mail', label: '邮箱', tools: mailTools },
  { id: 'shuiyuan', label: '水源社区', tools: shuiyuanTools },
  { id: 'web', label: '网页检索', tools: webTools },
];

export const agentTools = {
  ...commonTools,
  ...canvasTools,
  ...workspaceTools,
  ...todoTools,
  ...timetableTools,
  ...mailTools,
  ...webTools,
  ...shuiyuanTools,
};

/** 工具名 → 能力域；新增领域时需同时登记到上方 toolDomains。 */
export const toolDomainOf: Record<string, string> = Object.fromEntries(
  toolDomains.flatMap((domain) => Object.keys(domain.tools).map((name) => [name, domain.id])),
);
