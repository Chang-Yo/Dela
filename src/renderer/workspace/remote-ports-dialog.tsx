// 远端端口预览面板：远端监听中的端口开成 `ssh -L` 隧道，浏览器从本机回环访问。
// 状态都在主进程（清单 + 隧道注册表），面板每次打开/动作后拉一次快照，自己不记隧道。
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { ExternalLink, Globe, Loader2, RefreshCw, Square } from 'lucide-react';
import { Button } from '../components/ui/button';
import { dialogOverlay, dialogPanel } from '../components/ui/motion';
import { cn } from '../lib/utils';
import type { RemotePortsState } from '../../shared/api';
import { errorText } from './store';

export function RemotePortsDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<RemotePortsState | null>(null);
  const [working, setWorking] = useState(false);
  const [busyPort, setBusyPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const workspace = window.dela?.workspace;
    if (!workspace) return;
    setWorking(true);
    try {
      setState(await workspace.remotePorts(projectId));
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setWorking(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const openPort = async (port: number) => {
    const workspace = window.dela?.workspace;
    if (!workspace || busyPort !== null) return;
    setBusyPort(port);
    try {
      await workspace.openRemotePort(projectId, port);
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyPort(null);
    }
  };

  const stopPort = async (port: number) => {
    const workspace = window.dela?.workspace;
    if (!workspace || busyPort !== null) return;
    setBusyPort(port);
    try {
      await workspace.closeRemotePort(projectId, port);
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyPort(null);
    }
  };

  const tunnelOf = (port: number) => state?.tunnels.find((tunnel) => tunnel.remotePort === port);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && busyPort === null) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-w-md p-5')}>
          <div className="grid gap-1">
            <Dialog.Title className="text-13 font-semibold">远端端口</Dialog.Title>
            <Dialog.Description className="text-xs leading-relaxed text-ink-3">
              远端监听中的端口；「打开」会建立一条 SSH 隧道并在浏览器访问，停止后隧道关闭。
            </Dialog.Description>
          </div>
          <div className="mt-4 grid max-h-80 min-h-0 content-start gap-0.5 overflow-y-auto">
            {state === null && !error ? (
              <p className="flex items-center gap-2 py-4 text-xs text-ink-3" role="status">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                正在读取远端端口…
              </p>
            ) : (
              state?.ports.map((entry) => {
                const tunnel = tunnelOf(entry.port);
                return (
                  <div
                    className="flex min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 text-13 transition-colors duration-150 hover:bg-hover"
                    key={entry.port}
                  >
                    <Globe className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate text-ink-2" title={entry.process}>
                      {entry.process || '未知进程'}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-ink-3 tabular-nums">
                      :{entry.port}
                    </span>
                    {tunnel ? (
                      <>
                        <span className="shrink-0 font-mono text-2xs text-green tabular-nums">
                          → 127.0.0.1:{tunnel.localPort}
                        </span>
                        <Button
                          disabled={busyPort !== null}
                          onClick={() => void stopPort(entry.port)}
                          size="sm"
                          variant="ghost"
                        >
                          {busyPort === entry.port ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Square />
                          )}
                          停止
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={busyPort !== null}
                        onClick={() => void openPort(entry.port)}
                        size="sm"
                        variant="secondary"
                      >
                        {busyPort === entry.port ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <ExternalLink />
                        )}
                        打开
                      </Button>
                    )}
                  </div>
                );
              })
            )}
            {state && state.ports.length === 0 && state.tunnels.length === 0 && (
              <p className="px-2 py-4 text-xs text-ink-3">没有发现监听中的端口。</p>
            )}
            {state?.tunnels
              .filter((tunnel) => !state.ports.some((entry) => entry.port === tunnel.remotePort))
              .map((tunnel) => (
                <div
                  className="flex min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 text-13 transition-colors duration-150 hover:bg-hover"
                  key={`t-${tunnel.remotePort}`}
                >
                  <Globe className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate text-ink-3">
                    端口 {tunnel.remotePort}（进程已退出）
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-green tabular-nums">
                    → 127.0.0.1:{tunnel.localPort}
                  </span>
                  <Button
                    disabled={busyPort !== null}
                    onClick={() => void stopPort(tunnel.remotePort)}
                    size="sm"
                    variant="ghost"
                  >
                    {busyPort === tunnel.remotePort ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Square />
                    )}
                    停止
                  </Button>
                </div>
              ))}
          </div>
          {error && (
            <p className="mt-3 text-xs [overflow-wrap:anywhere] text-red" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button disabled={working} onClick={() => void reload()} size="sm" variant="ghost">
              {working ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新
            </Button>
            <Button disabled={busyPort !== null} onClick={onClose} size="sm" variant="secondary">
              关闭
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
