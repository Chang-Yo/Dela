import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Folder, Trash2 } from 'lucide-react';
import type { ChatSessionSummary } from '../../../core/protocol/agent';
import { chatClient } from './client';
import { Button } from '../../../ui/button';
import { SearchInput } from '../../../ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select';
import { useWorkspaceStore } from '../../workspace/view';
import { showToast } from '../../../ui/toast';
import { refreshSessionLists, useSessions, updateSession } from './sessions';
import { SectionHeader, SettingsGroup } from '../../settings/view';
import { Callout, ErrorText } from '../../../ui/alert';
import { errorMessage } from '../../../core/protocol/contract';
import type { Navigate } from '../../../app/module';

/** 项目筛选哨兵：Radix Select 不接受空串，「全部」与「随聊」（无项目）各用一个哨兵值。 */
const allProjects = '__all__';
const generalProject = '__general__';

type Group = { id: string | null; name: string; sessions: ChatSessionSummary[] };

export function ArchivedSection({ navigate }: { navigate: Navigate }) {
  const queryClient = useQueryClient();
  const archived = useQuery({
    queryKey: ['chat', 'archived'],
    queryFn: () => chatClient.archived(),
  });
  const sessions = archived.data;
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState(allProjects);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'one'; id: string } | { kind: 'all' } | null>(
    null,
  );
  const entries = useWorkspaceStore((state) => state.workspace.entries);

  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['chat', 'archived'] }),
      queryClient.invalidateQueries({ queryKey: ['chat', 'session-search'] }),
    ]);

  const projectName = (id: string | null) =>
    (id ? entries.find((entry) => entry.id === id)?.name : null) ?? '随聊';

  // 按项目归类；项目顺序沿用列表顺序（归档时间倒序）。
  const keyword = query.trim().toLowerCase();
  const filtered = (sessions ?? []).filter(
    (session) =>
      (projectFilter === allProjects || (session.projectId ?? generalProject) === projectFilter) &&
      (!keyword || session.title.toLowerCase().includes(keyword)),
  );
  const byProject = new Map<string, Group>();
  for (const session of filtered) {
    const id = session.projectId ?? null;
    const key = id ?? '';
    const group = byProject.get(key);
    if (group) group.sessions.push(session);
    else byProject.set(key, { id, name: projectName(id), sessions: [session] });
  }
  const groups = [...byProject.values()];

  const change = async (id: string, remove: boolean) => {
    if (busy || !window.dela) return;
    setBusy(true);
    try {
      if (remove) {
        await chatClient.remove(id);
        useSessions.getState().forgetSession(id);
      } else await updateSession(id, { archived: false });
      await reload();
      await refreshSessionLists();
      setConfirm(null);
    } catch (cause) {
      showToast({
        variant: 'error',
        title: remove ? '删除失败' : '恢复失败',
        description: errorMessage(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    if (busy || !window.dela || !sessions?.length) return;
    setBusy(true);
    try {
      // 逐条永久删除：主进程拒绝未归档会话，这里的数据本就全部已归档。
      for (const session of sessions) {
        await chatClient.remove(session.id);
        useSessions.getState().forgetSession(session.id);
      }
      await reload();
      await refreshSessionLists();
      setConfirm(null);
    } catch (cause) {
      showToast({ variant: 'error', title: '删除失败', description: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  };

  const projectOptions = (sessions ?? []).reduce<Array<{ id: string; name: string }>>(
    (options, session) => {
      const id = session.projectId ?? generalProject;
      if (!options.some((option) => option.id === id))
        options.push({ id, name: projectName(session.projectId ?? null) });
      return options;
    },
    [],
  );

  return (
    <div className="grid gap-10">
      <SectionHeader title="已归档对话" />
      {!window.dela ? (
        <p className="text-sm text-ink-3">已归档对话管理仅在桌面端可用。</p>
      ) : (
        <>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                aria-label="搜索已归档对话"
                className="min-w-52 flex-1"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索已归档对话"
                value={query}
              />
              <Select onValueChange={setProjectFilter} value={projectFilter}>
                <SelectTrigger aria-label="按项目筛选">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={allProjects}>全部项目</SelectItem>
                  {projectOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={busy || !sessions?.length}
                onClick={() => setConfirm(confirm?.kind === 'all' ? null : { kind: 'all' })}
                size="sm"
                variant="ghost"
              >
                <Trash2 />
                全部删除
              </Button>
            </div>
            <p className="text-xs text-ink-3">
              恢复后重新出现在历史列表；永久删除无法撤销。共 {sessions?.length ?? 0} 条。
            </p>
            {confirm?.kind === 'all' && (
              <Callout
                action={
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={busy}
                      onClick={() => void removeAll()}
                      size="sm"
                      variant="destructive"
                    >
                      确认全部删除
                    </Button>
                    <Button onClick={() => setConfirm(null)} size="sm" variant="ghost">
                      取消
                    </Button>
                  </div>
                }
              >
                永久删除全部 {sessions?.length ?? 0} 条已归档对话？此操作无法撤销。
              </Callout>
            )}
            {archived.error && <ErrorText>{errorMessage(archived.error)}</ErrorText>}
            {sessions && sessions.length === 0 && (
              <SettingsGroup>
                <p className="py-3.5 text-sm text-ink-3">没有已归档对话</p>
              </SettingsGroup>
            )}
            {sessions && sessions.length > 0 && groups.length === 0 && (
              <SettingsGroup>
                <p className="py-3.5 text-sm text-ink-3">没有匹配的已归档对话</p>
              </SettingsGroup>
            )}
          </div>
          <div className="grid gap-8">
            {groups.map((group) => (
              <SettingsGroup
                key={group.id ?? 'general'}
                title={
                  <span className="flex items-center gap-2">
                    <Folder aria-hidden="true" className="size-4 shrink-0 text-ink-3" />
                    <span className="truncate">{group.name}</span>
                    <span className="shrink-0 text-xs font-normal text-ink-3">
                      {group.sessions.length} 条
                    </span>
                  </span>
                }
              >
                <ul className="grid">
                  {group.sessions.map((session) => (
                    <li
                      className="flex items-center justify-between gap-3 border-b py-3 last:border-0"
                      key={session.id}
                    >
                      <div className="grid min-w-0 gap-0.5">
                        <span className="truncate text-sm" title={session.title}>
                          {session.title || '新对话'}
                        </span>
                        <span className="text-xs text-ink-3">
                          {new Date(session.updatedAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {confirm?.kind === 'one' && confirm.id === session.id ? (
                          <>
                            <Button
                              disabled={busy}
                              onClick={() => void change(session.id, true)}
                              size="sm"
                              variant="destructive"
                            >
                              确认永久删除
                            </Button>
                            <Button onClick={() => setConfirm(null)} size="sm" variant="ghost">
                              取消
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              aria-label={`查看 ${session.title}`}
                              onClick={() =>
                                navigate({
                                  page: 'chat',
                                  projectId: session.projectId ?? null,
                                  sessionId: session.id,
                                })
                              }
                              size="icon-sm"
                              title="查看对话"
                              variant="ghost"
                            >
                              <Eye />
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => void change(session.id, false)}
                              size="sm"
                              variant="secondary"
                            >
                              恢复
                            </Button>
                            <Button
                              aria-label={`永久删除 ${session.title}`}
                              disabled={busy}
                              onClick={() => setConfirm({ kind: 'one', id: session.id })}
                              size="icon-sm"
                              title="永久删除"
                              variant="ghost"
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </SettingsGroup>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
