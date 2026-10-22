// 一个会话里 Pi 扩展的界面状态（状态栏、文本小部件、工作提示）与 `/` 候选：主进程推全量，
// 这里只做订阅与按会话过滤。会话没开 Pi Packages 时两者都为空。
import { useEffect, useState } from 'react';
import type { ChatSlashCommand, ExtensionSessionState } from '../../../shared/api';

const emptyState = (sessionId: string): ExtensionSessionState => ({
  sessionId,
  statuses: [],
  widgets: [],
  workingMessage: null,
});

export function useExtensionSessionState(sessionId: string | null): ExtensionSessionState | null {
  const [state, setState] = useState<ExtensionSessionState | null>(null);
  useEffect(() => {
    const api = window.dela?.packages;
    if (!api || !sessionId) {
      setState(null);
      return;
    }
    let alive = true;
    setState(emptyState(sessionId));
    const unsubscribe = api.onSessionState((next) => {
      if (next.sessionId === sessionId) setState(next);
    });
    void api.sessionState(sessionId).then((next) => alive && setState(next));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [sessionId]);
  return state;
}

/** `/` 打开候选时才问一次：扩展命令要等会话实例建好、扩展加载完才知道。 */
export async function loadSessionCommands(sessionId: string | null): Promise<ChatSlashCommand[]> {
  if (!sessionId || !window.dela?.chat.listSessionCommands) return [];
  try {
    return await window.dela.chat.listSessionCommands(sessionId);
  } catch {
    return [];
  }
}
