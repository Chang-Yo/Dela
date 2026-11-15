// 新建远程项目：一个面板走完。上面是项目名称与服务器下拉框（已保存的连接 + ~/.ssh/config 里的主机），
// 选中服务器就自动连上（已连上的直接跳过），下面是目录选择器。连接表单在同一个面板里切换，
// 与「设置 › 远程」共用。事实都在主进程；这里只记「每台服务器上次停在哪个目录」这类偏好。
import { useState } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings2 } from 'lucide-react';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select';
import { cn } from '../../../ui/cn';
import type { WorkspaceEntry } from '../../../shared/api';
import type {
  RemoteConnection,
  RemoteDraft,
  SshConfigHost,
} from '../../../modules/remotes/contract';
import { usePreferences } from '../../app/preferences';
import { workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import {
  ConnectionForm,
  DirectoryBrowser,
  SetupProgress,
  channelDot,
  refreshRemoteConnections,
  remoteConnectionsQuery,
  remotesClient,
  sshConfigHostsQuery,
  tildePath,
  useRemoteChannels,
  useRemoteState,
} from '../../../modules/remotes/view';
import { useNavigationStore } from '../../navigation/view';
import { purgeRemovedEntries } from '../../workbench/removed-cleanup';
import { ErrorText } from '../../../ui/alert';
import { Spinner } from '../../../ui/spinner';
import { Dialog, DialogContent, DialogTitle } from '../../../ui/dialog';
import { Field } from '../../../ui/field';
import { errorMessage } from '../../../core/protocol/contract';

/** 下拉框的值：已保存连接用 id，ssh config 候选用 `config:<别名>`，新建用哨兵。 */
const NEW_CONNECTION = '__new__';
const configValue = (alias: string) => `config:${alias}`;

type Mode =
  { kind: 'browse' } | { kind: 'form'; connection?: RemoteConnection; initial?: RemoteDraft };

const draftOf = (connection: RemoteConnection): RemoteDraft => ({
  label: connection.label,
  host: connection.host,
  port: connection.port,
  keyPath: connection.keyPath,
});

const destinationOf = (connection: Pick<RemoteConnection, 'host' | 'port'>) =>
  connection.port ? `${connection.host}:${connection.port}` : connection.host;

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? '';

/** 下拉框里候选的副标题：config 里的 User@HostName:Port，没写的就不显示。 */
function candidateDetail(host: SshConfigHost): string {
  const target = host.hostName ? `${host.user ? `${host.user}@` : ''}${host.hostName}` : '';
  return `${target}${host.port ? `:${host.port}` : ''}` || 'ssh config';
}

const noCandidates: SshConfigHost[] = [];

export function NewRemoteProjectDialog({
  open,
  onClose,
  onImported,
  /** 打开时直接选中的连接（设置页「新建项目」或项目行进来时）。 */
  initialConnectionId,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (entry: WorkspaceEntry) => void;
  initialConnectionId?: string;
}) {
  const [importing, setImporting] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !importing) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        // toast 挂在对话框 portal 之外：点它（关闭、选中文字）不算点到对话框外面。
        onInteractOutside={(event) => {
          if ((event.target as Element | null)?.closest('[data-toast-host]'))
            event.preventDefault();
        }}
        className="grid max-h-[85vh] max-w-xl grid-rows-[auto_1fr] gap-4 p-5"
      >
        <NewRemoteProjectPanel
          importing={importing}
          initialConnectionId={initialConnectionId}
          onClose={onClose}
          onImported={onImported}
          onImportingChange={setImporting}
        />
      </DialogContent>
    </Dialog>
  );
}

// 内容只在对话框打开时挂载：每次打开都是一份全新的状态，并重读连接与候选。
function NewRemoteProjectPanel({
  importing,
  initialConnectionId,
  onClose,
  onImported,
  onImportingChange,
}: {
  importing: boolean;
  initialConnectionId?: string;
  onClose: () => void;
  onImported: (entry: WorkspaceEntry) => void;
  onImportingChange: (importing: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const connections = useQuery(remoteConnectionsQuery).data ?? null;
  const candidates = useQuery(sshConfigHostsQuery).data ?? noCandidates;
  const channels = useRemoteChannels();
  const homes = useRemoteState((state) => state.homes);
  const log = useRemoteState((state) => state.setupLog);
  const lastDirectory = usePreferences((state) => state.remoteLastDirectory);
  const projects = useWorkspaceStore((state) => state.workspace.entries);

  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 默认选中传进来的、或上次用过的那台、或第一台；用户选过之后以用户的为准。
  const preferred =
    connections?.find((item) => item.id === initialConnectionId) ??
    connections?.find((item) => lastDirectory[item.host]) ??
    connections?.[0];
  const connectionId = chosenId ?? preferred?.id ?? null;
  const connection = connections?.find((item) => item.id === connectionId) ?? null;
  const destination = connection?.host ?? '';
  const home = connection ? (homes[destination] ?? null) : null;
  // 目录就是用户上次停在的位置，没有就从主目录起步。
  const path = connection ? (lastDirectory[destination] ?? home) : null;
  const target = selected ?? path;
  // 名字默认跟着目录走；用户自己改过就不再跟。
  const name = typedName ?? (target ? basename(target) || target : '');

  // 选中服务器就连：同一时刻只认当前这台，换台之后旧的结果落不到新的服务器上。
  const prepare = useQuery({
    queryKey: ['remotes', 'prepare', connection?.host, connection?.port, connection?.keyPath],
    queryFn: connection
      ? async () => {
          useRemoteState.getState().clearSetupLog();
          const result = await remotesClient.prepare(draftOf(connection));
          if (result.ok && result.home)
            useRemoteState.getState().setHome(connection.host, result.home);
          return result;
        }
      : skipToken,
    gcTime: 0,
  });
  // 已经连上过：直接回到上次的位置，连接在后台确认一遍，不打扰。
  const warm = channels[destination]?.state === 'ready' && home !== null;
  const connecting = prepare.isFetching && !warm;
  const failure = prepare.isFetching
    ? null
    : prepare.isError
      ? errorMessage(prepare.error)
      : prepare.data && !prepare.data.ok
        ? prepare.data.message
        : null;

  const choose = (next: RemoteConnection) => {
    setChosenId(next.id);
    setSelected(null);
    setError(null);
  };

  const chooseValue = (value: string) => {
    if (value === NEW_CONNECTION) {
      setMode({ kind: 'form' });
      return;
    }
    if (value.startsWith('config:')) {
      // config 里的主机：别名就是目的地，其余交给 ssh 解析。先存成连接，再连。
      const alias = value.slice('config:'.length);
      if (!window.dela) return;
      void remotesClient
        .save({ label: alias, host: alias, port: null, keyPath: null })
        .then(async (saved) => {
          await refreshRemoteConnections(queryClient);
          choose(saved);
        })
        .catch((cause: unknown) => setError(errorMessage(cause)));
      return;
    }
    const next = connections?.find((item) => item.id === value);
    if (next) choose(next);
  };

  const rememberDirectory = (destination: string, path: string) => {
    const { remoteLastDirectory, setPreference } = usePreferences.getState();
    setPreference('remoteLastDirectory', { ...remoteLastDirectory, [destination]: path });
  };

  const navigate = (next: string) => {
    setSelected(null);
    rememberDirectory(destination, next);
  };

  // 这台服务器上已登记过的项目目录，最近的在前。
  const recent = projects
    .filter((entry) => entry.kind === 'project' && entry.remoteId === connectionId && entry.path)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((entry) => entry.path!)
    .slice(0, 5);

  const importProject = async () => {
    if (!window.dela || !connectionId || !target || importing) return;
    onImportingChange(true);
    setError(null);
    try {
      const created = await workspaceClient.importRemoteProject({
        remoteId: connectionId,
        path: target,
        name: name.trim() || undefined,
      });
      rememberDirectory(destination, path ?? target);
      await useWorkspaceStore.getState().refresh();
      onImported(created);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      onImportingChange(false);
    }
  };

  const ready = Boolean(connection) && !connecting && !failure && path !== null;
  const existing = recent.includes(target ?? '');

  return (
    <>
      <DialogTitle>{mode.kind === 'form' ? '远程连接' : '新建远程项目'}</DialogTitle>

      {mode.kind === 'form' ? (
        <ConnectionForm
          connection={mode.connection}
          initial={mode.initial}
          onBack={() => setMode({ kind: 'browse' })}
          onOpenProject={(id) => useNavigationStore.getState().openProject(id)}
          onProjectsRemoved={purgeRemovedEntries}
          onRemoved={(id) => {
            setMode({ kind: 'browse' });
            // 删掉的是当前连接：保持空选，不自动换到别的服务器。
            if (id === connectionId) setChosenId(id);
          }}
          onSaved={(saved) => {
            setMode({ kind: 'browse' });
            choose(saved);
          }}
        />
      ) : (
        <form
          className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void importProject();
          }}
        >
          <Field label="项目名称">
            <Input
              aria-label="项目名称"
              autoComplete="off"
              onChange={(event) => setTypedName(event.target.value)}
              placeholder="默认用目录名"
              value={name}
            />
          </Field>

          <div className="grid gap-1.5 text-xs text-ink-2">
            服务器
            <div className="flex items-center gap-2">
              <Select onValueChange={chooseValue} value={connectionId ?? ''}>
                <SelectTrigger aria-label="服务器" className="w-full flex-1">
                  <SelectValue placeholder="选择服务器" />
                </SelectTrigger>
                <SelectContent>
                  {(connections ?? []).map((item) => {
                    const dot = channelDot(channels[item.host]);
                    return (
                      <SelectItem key={item.id} value={item.id}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-label={dot.label}
                            className={cn('size-1.5 shrink-0 rounded-full', dot.className)}
                          />
                          <span className="truncate">{item.label}</span>
                          {/* 名称默认就是目的地：两者相同时不重复写一遍。 */}
                          {destinationOf(item) !== item.label && (
                            <span className="truncate font-normal text-ink-3">
                              {destinationOf(item)}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                  {candidates.length > 0 && (
                    <p className="px-2 pt-2 pb-1 text-xs text-ink-3">来自 ~/.ssh/config</p>
                  )}
                  {candidates.map((host) => (
                    <SelectItem key={host.alias} value={configValue(host.alias)}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-1.5 shrink-0 rounded-full border border-line-strong" />
                        <span className="truncate">{host.alias}</span>
                        <span className="truncate font-normal text-ink-3">
                          {candidateDetail(host)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_CONNECTION}>
                    <span className="flex items-center gap-2">
                      <Plus className="size-3.5" />
                      新建连接…
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                aria-label="编辑连接"
                disabled={!connection}
                onClick={() => connection && setMode({ kind: 'form', connection })}
                size="icon-sm"
                title="编辑连接"
                type="button"
                variant="ghost"
              >
                <Settings2 />
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 content-start gap-3">
            {connections !== null && connections.length === 0 && candidates.length === 0 && (
              <div className="grid gap-2 rounded-card border border-dashed border-line px-4 py-6 text-center">
                <p className="text-sm text-ink-2">还没有可用的服务器</p>
                <p className="text-xs text-ink-3">
                  新建一个 SSH 连接；在 ~/.ssh/config 里配置过的主机会自动出现在这里。
                </p>
                <Button
                  className="mx-auto mt-1"
                  onClick={() => setMode({ kind: 'form' })}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Plus />
                  新建连接
                </Button>
              </div>
            )}
            {connection && (connecting || failure) && (
              <SetupProgress
                failure={failure}
                log={log}
                onEdit={() => setMode({ kind: 'form', connection })}
                onRetry={() => void prepare.refetch()}
                running={connecting}
              />
            )}
            {connection && !failure && path !== null && (
              <DirectoryBrowser
                draft={draftOf(connection)}
                home={home}
                onNavigate={navigate}
                onSelect={setSelected}
                path={path}
                recent={recent}
                selected={selected}
              />
            )}
          </div>

          <div className="grid gap-2">
            {error && <ErrorText>{error}</ErrorText>}
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-xs text-ink-3" title={target ?? undefined}>
                {target ? (
                  <>
                    项目目录 <code className="font-mono text-ink-2">{tildePath(target, home)}</code>
                    {existing && '（已是项目，将直接打开）'}
                  </>
                ) : null}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button disabled={importing} onClick={onClose} type="button" variant="ghost">
                  取消
                </Button>
                <Button disabled={!ready || !target || importing} type="submit">
                  {importing && <Spinner />}
                  {existing ? '打开项目' : '添加项目'}
                </Button>
              </div>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
