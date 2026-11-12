// 打开着的 Pi 会话实例：会话运行层建立和销毁，快照、跨会话读取与旁问只读它们。
import { existsSync } from 'node:fs';
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AgentToolResult, ChatAskInput } from '../../../shared/api';
import type { TaskNotice } from '../tasks';
import { requirePiSync, row } from './store';

export interface Live {
  session: AgentSession;
  cwd: string;
  providerId: string;
  /** 当前 Run（ask 进行中）；空闲为 undefined。 */
  run?: Run;
  unsubscribe: () => void;
  stale?: boolean;
  /** 最近一次压缩后 Pi 估计的上下文 token 数：模型还没回复、实际用量未知时代替它显示。 */
  compactedTokens?: number;
}

export interface Run {
  id: string;
  tool?: string;
  cancelled?: boolean;
  /** Pi 已答完、Dela 还在收尾：这时发来的消息等收尾结束后作为新一轮发出。 */
  finishing?: boolean;
  /** 插进本轮的消息；附件到本轮结束才释放，撤回的从这里拿回原始输入。 */
  steers: { prompt: string; input: ChatAskInput }[];
  /** 插进本轮的后台任务通知：Pi 清空插队队列时会一并丢掉，轮末或撤回后补投没送达的。 */
  notices: TaskNotice[];
  done: Promise<void>;
}

export const live = new Map<string, Live>();

/** 运行中的工具步骤（含 start/update 期间的输入与增量输出），按会话、toolCallId 索引。 */
export const liveSteps = new Map<string, Map<string, AgentToolResult>>();

export const sessionRunning = (id: string) => Boolean(live.get(id)?.run);

/** 跨会话读取的原文：打开着的会话读内存里的记录（含本轮已落下的消息），其余直接读 JSONL。 */
export function sessionBranch(id: string): { branch: SessionEntry[]; runningTurn?: string } {
  const entry = live.get(id);
  if (entry)
    return { branch: entry.session.sessionManager.getBranch(), runningTurn: entry.run?.id };
  const { file } = row(id);
  if (!file || !existsSync(file)) return { branch: [] };
  return { branch: requirePiSync().SessionManager.open(file).getBranch() };
}
