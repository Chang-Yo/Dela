import { useEffect, useState } from 'react';
import { ArchiveRestore, Eye, Trash2 } from 'lucide-react';
import type { ChatSessionSummary } from '../../../../shared/api';
import { Button } from '../../../components/ui/button';
import { errorText, useWorkspaceStore } from '../../../workspace/store';
import { refreshSessionLists, useSessions, updateSession } from '../../../sessions/store';
import { useNavigationStore } from '../../../app/navigation';
import { useProjectNavPrefs } from '../../../navigation/store';

export function ArchivedSessions() {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const preferences = useProjectNavPrefs((state) => state.projects);
  const setProject = useProjectNavPrefs((state) => state.setProject);
  useEffect(() => {
    let active = true;
    if (!window.dela) {
      setLoading(false);
      return;
    }
    void window.dela.session
      .archived()
      .then((list) => {
        if (active) setSessions(list);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const change = async (id: string, remove: boolean) => {
    if (busy || !window.dela) return;
    setBusy(true);
    setError(null);
    try {
      if (remove) {
        await window.dela.session.remove(id);
        useSessions.getState().forgetSession(id);
      } else await updateSession(id, { archived: false });
      setSessions(await window.dela.session.archived());
      await refreshSessionLists();
      setConfirmId(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      data-setting-id="archived-chats"
      className="grid gap-3 rounded-xl border bg-card p-5 max-md:p-4"
    >
      <h2 className="text-sm font-medium">已归档对话</h2>
      {/* 永久删除不可逆：破坏性操作的必要警示。 */}
      <p className="text-xs text-muted-foreground">恢复后重新出现在历史列表；永久删除无法撤销。</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-xs text-muted-foreground">
          加载中…
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">没有已归档对话</p>
      ) : (
        sessions.map((session) => (
          <div
            key={session.id}
            className="flex min-w-0 flex-wrap items-center gap-2 border-b py-2 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm" title={session.title}>
                {session.title || '新对话'}
              </p>
              <p className="text-xs text-muted-foreground">
                {entries.find((entry) => entry.id === session.projectId)?.name ?? '随聊'}
              </p>
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              title="查看对话"
              aria-label={`查看 ${session.title}`}
              onClick={() =>
                useNavigationStore.getState().openChat(session.id, session.projectId ?? null)
              }
            >
              <Eye />
            </Button>
            <Button
              disabled={busy}
              size="icon-xs"
              variant="ghost"
              title="恢复对话"
              aria-label={`恢复 ${session.title}`}
              onClick={() => void change(session.id, false)}
            >
              <ArchiveRestore />
            </Button>
            {confirmId === session.id ? (
              <>
                <Button
                  disabled={busy}
                  size="sm"
                  variant="destructive"
                  onClick={() => void change(session.id, true)}
                >
                  永久删除
                </Button>
                <Button
                  disabled={busy}
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmId(null)}
                >
                  取消
                </Button>
              </>
            ) : (
              <Button
                disabled={busy}
                size="icon-xs"
                variant="ghost"
                title="永久删除"
                aria-label={`永久删除 ${session.title}`}
                onClick={() => setConfirmId(session.id)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))
      )}
      {entries
        .filter((entry) => entry.kind === 'project' && preferences[entry.id]?.hidden)
        .map((project) => (
          <div key={project.id} className="flex items-center gap-2 border-t pt-3">
            <span className="min-w-0 flex-1 truncate text-xs">已隐藏项目：{project.name}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setProject(project.id, { hidden: false })}
            >
              恢复入口
            </Button>
          </div>
        ))}
    </section>
  );
}
