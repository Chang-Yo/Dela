// 打开着的 Pi 会话实例：会话运行层建立和销毁，快照、跨会话读取与旁问只读它们。
import { existsSync } from 'node:fs';
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AgentToolResult, ChatAskInput } from '../../protocol/agent';
import type { TaskNotice } from '../tasks';
import { requirePiSync, row } from './store';

export interface Live {
  session: AgentSession;
  cwd: string;
  providerId: string;
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
  finishing?: boolean;
  steers: { prompt: string; input: ChatAskInput }[];
  /** 插进本轮的后台任务通知：Pi 清空插队队列时会一并丢掉，轮末或撤回后补投没送达的。 */
  notices: TaskNotice[];
  done: Promise<void>;
}

export const live = new Map<string, Live>();

export const liveSteps = new Map<string, Map<string, AgentToolResult>>();

export const sessionRunning = (id: string) => Boolean(live.get(id)?.run);

export function sessionBranch(id: string): { branch: SessionEntry[]; runningTurn?: string } {
  const entry = live.get(id);
  if (entry)
    return { branch: entry.session.sessionManager.getBranch(), runningTurn: entry.run?.id };
  const { file } = row(id);
  if (!file || !existsSync(file)) return { branch: [] };
  return { branch: requirePiSync().SessionManager.open(file).getBranch() };
}
