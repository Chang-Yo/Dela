import type { WorkspaceChat, WorkspaceEntry } from '../../../shared/api';

/** 输入框上方浮岛要显示的信息：所在项目（通用池为随聊）与远端标记。 */
export interface ComposerContext {
  /** 通用池为 null。 */
  projectId: string | null;
  name: string;
  /** 远端项目用云朵图标，与侧栏项目行一致。 */
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
