// 新建远程项目：一个面板走完。上面是项目名称与服务器下拉框（已保存的连接 + ~/.ssh/config 里的主机），
// 选中服务器就自动连上（已连上的直接跳过），下面是目录选择器。连接表单在同一个面板里切换，
// 与「设置 › 远程」共用。事实都在主进程；这里只记「每台服务器上次停在哪个目录」这类偏好。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Loader2, Plus, Settings2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';
import type {
  RemoteConnection,
  RemoteDraft,
  RemoteSetupProgress,
  SshConfigHost,
  WorkspaceEntry,
} from '../../../shared/api';
import { errorText, useWorkspaceStore } from '../store';
import { ConnectionForm } from './ConnectionForm';
import { DirectoryBrowser, tildePath } from './DirectoryBrowser';
import { SetupProgress } from './SetupProgress';
import { channelDot, useRemoteState } from './remote-state';

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
  const connections = useRemoteState((state) => state.connections);
  const candidates = useRemoteState((state) => state.candidates);
  const channels = useRemoteState((state) => state.channels);
  const homes = useRemoteState((state) => state.homes);
  const { load, setHome, rememberDirectory } = useRemoteState.getState();
  const projects = useWorkspaceStore((state) => state.workspace.entries);

  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<RemoteSetupProgress[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 同一时刻只认最后一次连接：用户在下拉框里连换几台时，旧的结果不能落到新的服务器上。 */
  const attempt = useRef(0);

  const connection = connections?.find((item) => item.id === connectionId) ?? null;
  const destination = connection?.host ?? '';
  const home = connection ? (homes[destination] ?? null) : null;
  const target = selected ?? path;

  // 打开时：重读连接与候选；默认选中传进来的、或上次用过的那台、或第一台。
  useEffect(() => {
    if (!open) return;
    setMode({ kind: 'browse' });
    setName('');
    setNameTouched(false);
    setError(null);
    void load().then(() => {
      const list = useRemoteState.getState().connections ?? [];
      const preferred =
        list.find((item) => item.id === initialConnectionId) ??
        list.find((item) => useRemoteState.getState().lastDirectory[item.host]) ??
        list[0];
      if (preferred) void choose(preferred);
      else {
        setConnectionId(null);
        setPath(null);
      }
    });
    // 只在打开时跑一次；choose 读的都是最新状态。
  }, [open]);

  // 引导进度由主进程推着走：只收当前这一台的（progress 本身不带目的地，靠 attempt 守住）。
  useEffect(() => {
    if (!open) return;
    return window.dela?.remotes.onSetupProgress((progress) =>
      setLog((previous) => [...previous, progress]),
    );
  }, [open]);

  // 名字默认跟着目录走；用户自己改过就不再跟。
  useEffect(() => {
    if (!nameTouched) setName(target ? basename(target) || target : '');
  }, [target, nameTouched]);

  async function choose(next: RemoteConnection) {
    const remotes = window.dela?.remotes;
    if (!remotes) return;
    const id = ++attempt.current;
    setConnectionId(next.id);
    setSelected(null);
    setFailure(null);
    setError(null);
    setLog([]);
    const known = useRemoteState.getState();
    const knownHome = known.homes[next.host];
    // 已经连上过：直接回到上次的位置，不等任何东西；连接在后台确认一遍。
    setPath(known.lastDirectory[next.host] ?? knownHome ?? null);
    setConnecting(known.channels[next.host]?.state !== 'ready' || !knownHome);
    try {
      const result = await remotes.prepare(draftOf(next));
      if (id !== attempt.current) return;
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      if (result.home) setHome(next.host, result.home);
      setPath((current) => current ?? known.lastDirectory[next.host] ?? result.home);
    } catch (cause) {
      if (id === attempt.current) setFailure(errorText(cause));
    } finally {
      if (id === attempt.current) setConnecting(false);
    }
  }

  const chooseValue = (value: string) => {
    if (value === NEW_CONNECTION) {
      setMode({ kind: 'form' });
      return;
    }
    if (value.startsWith('config:')) {
      // config 里的主机：别名就是目的地，其余交给 ssh 解析。先存成连接，再连。
      const alias = value.slice('config:'.length);
      void window.dela?.remotes
        .save({ label: alias, host: alias, port: null, keyPath: null })
        .then(async (saved) => {
          await load();
          await choose(saved);
        })
        .catch((cause: unknown) => setError(errorText(cause)));
      return;
    }
    const next = connections?.find((item) => item.id === value);
    if (next) void choose(next);
  };

  const navigate = (next: string) => {
    setPath(next);
    setSelected(null);
    if (destination) rememberDirectory(destination, next);
  };

  // 这台服务器上已登记过的项目目录，最近的在前。
  const recent = useMemo(
    () =>
      projects
        .filter(
          (entry) => entry.kind === 'project' && entry.remoteId === connectionId && entry.path,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((entry) => entry.path!)
        .slice(0, 5),
    [projects, connectionId],
  );

  const importProject = async () => {
    const dela = window.dela;
    if (!dela || !connectionId || !target || importing) return;
    setImporting(true);
    setError(null);
    try {
      const created = await dela.workspace.importRemoteProject(
        connectionId,
        target,
        name.trim() || undefined,
      );
      rememberDirectory(destination, path ?? target);
      await useWorkspaceStore.getState().refresh();
      onImported(created);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setImporting(false);
    }
  };

  const ready = Boolean(connection) && !connecting && !failure && path !== null;
  const existing = recent.includes(target ?? '');

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !importing) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-describedby={undefined}
          // toast 挂在对话框 portal 之外：点它（关闭、选中文字）不算点到对话框外面。
          onInteractOutside={(event) => {
            if ((event.target as Element | null)?.closest('[data-toast-host]'))
              event.preventDefault();
          }}
          className={cn(dialogPanel, 'grid max-h-[85vh] max-w-xl grid-rows-[auto_1fr] gap-4 p-5')}
        >
          <Dialog.Title className="text-base font-semibold">
            {mode.kind === 'form' ? '远程连接' : '新建远程项目'}
          </Dialog.Title>

          {mode.kind === 'form' ? (
            <ConnectionForm
              connection={mode.connection}
              initial={mode.initial}
              onBack={() => setMode({ kind: 'browse' })}
              onRemoved={(id) => {
                setMode({ kind: 'browse' });
                if (id === connectionId) setConnectionId(null);
                void load();
              }}
              onSaved={(saved) => {
                setMode({ kind: 'browse' });
                void load().then(() => choose(saved));
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
              <label className="grid gap-1.5 text-xs text-ink-2">
                项目名称
                <Input
                  aria-label="项目名称"
                  autoComplete="off"
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameTouched(true);
                  }}
                  placeholder="默认用目录名"
                  value={name}
                />
              </label>

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
                        <p className="px-2 pt-2 pb-1 text-2xs text-ink-3">来自 ~/.ssh/config</p>
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
                    <p className="text-13 text-ink-2">还没有可用的服务器</p>
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
                    onRetry={() => void choose(connection)}
                    running={connecting}
                  />
                )}
                {connection && !failure && path !== null && (
                  <DirectoryBrowser
                    destination={destination}
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
                {error && (
                  <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
                    {error}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-xs text-ink-3" title={target ?? undefined}>
                    {target ? (
                      <>
                        项目目录{' '}
                        <code className="font-mono text-ink-2">{tildePath(target, home)}</code>
                        {existing && '（已是项目，将直接打开）'}
                      </>
                    ) : null}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button disabled={importing} onClick={onClose} type="button" variant="ghost">
                      取消
                    </Button>
                    <Button disabled={!ready || !target || importing} type="submit">
                      {importing && <Loader2 className="animate-spin" />}
                      {existing ? '打开项目' : '添加项目'}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
