import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../database';

/** Run 状态机：pending → running → completed/stopped/failed/interrupted；
 *  waiting_input 状态入模型、本轮不触发；interrupted 仅由启动时的中断识别写入。 */

/** steps 轻量索引项：input/output 全文留在会话消息 JSON，避免双写（裁决 3）。 */
export interface RunStep {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  finishedAt?: number;
}

/** 活跃 Run 的内存态：取消信号、当前工具与步骤索引（写穿到 runs 表）。 */
export interface ActiveRun {
  runId: string;
  controller: AbortController;
  /** 当前执行中的工具名；空闲段为 undefined。 */
  tool?: string;
  steps: RunStep[];
}

/** 每个 session 至多一个活跃 Run（同 session 串行、跨 session 并行，裁决 9）。 */
export const activeRuns = new Map<string, ActiveRun>();

/** 请求摘要：文本前缀与引用/附件名，不含正文全文。 */
export type RunRequest = {
  text: string;
  sources?: { key: string; title: string }[];
  attachments?: { name: string }[];
};

/** 落库 pending 行：ask 处理开始前创建；发送前校验失败由此态直接转 failed。 */
export function createRun(
  sessionId: string,
  projectId: string | null,
  request: RunRequest,
): string {
  const runId = randomUUID();
  getDatabase()
    .prepare(
      'INSERT INTO runs (id, session_id, project_id, status, request, steps, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      runId,
      sessionId,
      projectId,
      'pending',
      JSON.stringify(request),
      '[]',
      new Date().toISOString(),
    );
  return runId;
}

/** 引用读取成功、首次模型请求前转 running，并补全请求摘要。 */
export function markRunRunning(runId: string, request: RunRequest): void {
  getDatabase()
    .prepare("UPDATE runs SET status='running', request=? WHERE id=?")
    .run(JSON.stringify(request), runId);
}

/** 写入终态与 ended_at；error 为 failed/interrupted 的原因。 */
export function finishRun(
  runId: string,
  status: 'completed' | 'failed' | 'stopped' | 'interrupted',
  error?: string,
): void {
  getDatabase()
    .prepare('UPDATE runs SET status=?, error=?, ended_at=? WHERE id=?')
    .run(status, error ?? null, new Date().toISOString(), runId);
}

function persistSteps(runId: string, steps: RunStep[]): void {
  getDatabase().prepare('UPDATE runs SET steps=? WHERE id=?').run(JSON.stringify(steps), runId);
}

/** 工具开始：追加 running 步骤（onToolStart）。 */
export function appendRunStep(run: ActiveRun, call: { id: string; name: string }): void {
  run.steps.push({ id: call.id, name: call.name, status: 'running', startedAt: Date.now() });
  persistSteps(run.runId, run.steps);
}

/** 工具结束：回填步骤终态（onToolResult）；{ok:false} 输出记为 failed。 */
export function completeRunStep(run: ActiveRun, id: string, failed: boolean): void {
  const step = run.steps.find((item) => item.id === id);
  if (!step) return;
  step.status = failed ? 'failed' : 'completed';
  step.finishedAt = Date.now();
  persistSteps(run.runId, run.steps);
}

/** 应用启动早期调用一次：上次退出的开放状态 Run 标记为 interrupted 终态（不自动续跑）。 */
export function interruptStaleRuns(): void {
  getDatabase()
    .prepare(
      "UPDATE runs SET status='interrupted', error='应用退出时中断', ended_at=? WHERE status IN ('pending','running')",
    )
    .run(new Date().toISOString());
}
