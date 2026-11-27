import type { WorkspaceChat } from '../../../core/protocol/agent';
import type { WorkspaceEntry } from '../../workspace/contract';

export interface ComposerContext {
  projectId: string | null;
  name: string;
  remote: boolean;
}

/** 浮岛只属于新对话：已有历史（或本轮正在跑、已发出待推送）就撤掉，不长期占位。 */
export function composerContext(
  chat: WorkspaceChat | null,
  project: WorkspaceEntry | null,
  busy = false,
): ComposerContext | null {
  if (!chat || busy || chat.running || chat.messages.length > 0) return null;
  return {
    projectId: project?.id ?? null,
    name: project?.name ?? '随聊',
    remote: Boolean(project?.remoteId),
  };
}
