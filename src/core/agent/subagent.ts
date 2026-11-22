/**
 * 子 Agent（task 工具）：在父会话的目录下另开一个历史为空的会话，工具与父会话相同（不含 task），
 * 只把最终回复交回父会话。同时运行的子 Agent 数全应用合计，超出直接报错，不排队。
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import type { TaskStatus, SubagentDetails } from '../protocol/agent';
import { hostPorts } from '../ports';
import { sessionRunning } from './session/live';
import { insertSubagentSession, row } from './session/store';
import { taskRunning, trackTask, type TaskParent } from './tasks';

const LIMIT_KEY = 'subagent-limit';
const SUBAGENT_LIMIT = { min: 1, max: 16, default: 4 };
const limitSchema = z.number().int().min(SUBAGENT_LIMIT.min).max(SUBAGENT_LIMIT.max);

export function readSubagentLimit(): number {
  const found = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(LIMIT_KEY) as { value: string } | undefined;
  const parsed = limitSchema.safeParse(found ? Number(found.value) : undefined);
  return parsed.success ? parsed.data : SUBAGENT_LIMIT.default;
}

export function setSubagentLimit(value: unknown): number {
  const limit = limitSchema.parse(value);
  hostPorts()
    .database()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(LIMIT_KEY, String(limit));
  return limit;
}

export interface SubagentResult {
  status: Exclude<TaskStatus, 'running'>;
  reply: string | null;
  error?: string;
}

export type RunSubagent = (
  id: string,
  prompt: string,
  signal: AbortSignal | undefined,
) => Promise<SubagentResult>;

let running = 0;

const DESCRIPTION = `派一个子 Agent 独立完成一项任务，等它做完后返回它的最终回复。
子 Agent 看不到当前对话的历史，工具与你相同（不能再派子 Agent），工作目录相同。prompt 里写清背景、目标、要交回什么，以及允许修改的文件范围；并行的子 Agent 改同一个文件会互相覆盖，派活时划好边界。
同一条回复里调用多次 task，这些子 Agent 会并行运行。返回结果里的 taskId 可用来续接这个子 Agent 追问（它保留之前的对话）。
background 为 true 时立即返回 taskId，子 Agent 在后台运行，结束时你会自动收到它的最终回复；期间可用 task_output 查看、task_stop 停止。
需要总结或梳理另一个会话时，派一个子 Agent 用 session_read 读完目标会话再汇报，不要自己把整段会话读进上下文。`;

export function taskTool(
  parent: TaskParent,
  cwd: string,
  runSubagent: RunSubagent,
): ToolDefinition {
  return {
    name: 'task',
    label: 'task',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: '几个字的任务名，显示给用户' },
        prompt: { type: 'string', description: '交给子 Agent 的完整任务说明' },
        taskId: { type: 'string', description: '续接之前派出的子 Agent；省略时新派一个' },
        background: { type: 'boolean', description: 'true 时在后台运行，不等它结束' },
      },
      required: ['description', 'prompt'],
    } as unknown as ToolDefinition['parameters'],
    async execute(
      _id,
      params: { description: string; prompt: string; taskId?: string; background?: boolean },
      signal,
      onUpdate,
    ) {
      const limit = readSubagentLimit();
      if (running >= limit)
        throw new Error(
          `同时运行的子 Agent 已达上限（${limit} 个）：等已有的结束后再派，或请用户在设置 › 内置能力里调高上限`,
        );
      if (params.taskId) {
        let owner: string | null = null;
        try {
          owner = row(params.taskId).parent_id;
        } catch {
          // 不存在的 taskId 与别人的子 Agent 一样报错。
        }
        if (owner !== parent.id) throw new Error(`没有这个子 Agent：${params.taskId}`);
        if (taskRunning(params.taskId) || sessionRunning(params.taskId))
          throw new Error('这个子 Agent 还在运行，等它结束再续接');
      }
      const taskId = params.taskId ?? insertSubagentSession(parent.id, params.description, cwd);
      running += 1;
      if (params.background) {
        const abort = new AbortController();
        trackTask(
          {
            id: taskId,
            parent,
            kind: 'subagent',
            label: params.description,
            stop: () => abort.abort(),
          },
          runSubagent(taskId, params.prompt, abort.signal).finally(() => (running -= 1)),
        );
        return {
          content: [
            {
              type: 'text',
              text: `taskId: ${taskId}\n\n已在后台运行。结束时会自动通知你，不需要轮询。`,
            },
          ],
          details: {
            taskId,
            status: 'running',
            background: true,
          } satisfies SubagentDetails,
        };
      }
      try {
        // 先交出 taskId：运行中的子 Agent 也能从父会话打开。
        onUpdate?.({
          content: [],
          details: { taskId, status: 'running' } satisfies SubagentDetails,
        });
        const result = await runSubagent(taskId, params.prompt, signal);
        const final: SubagentDetails = { taskId, status: result.status, reply: result.reply };
        const text =
          result.status === 'completed'
            ? (result.reply ?? '（子 Agent 没有给出最终回复）')
            : result.status === 'stopped'
              ? `子 Agent 已停止。${result.reply ? `停止前最后的回复：\n${result.reply}` : ''}`
              : `子 Agent 执行失败：${result.error ?? '未知错误'}`;
        return {
          content: [{ type: 'text', text: `taskId: ${taskId}\n\n${text}` }],
          details: final,
          ...(result.status === 'completed' ? {} : { isError: true }),
        };
      } finally {
        running -= 1;
      }
    },
  };
}
