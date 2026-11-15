// 远端端口预览面板：远端监听中的端口开成 `ssh -L` 隧道，浏览器从本机回环访问。
// 状态都在主进程（清单 + 隧道注册表），面板每次打开/动作后拉一次快照，自己不记隧道。
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Globe, RefreshCw, Square } from 'lucide-react';
import { Button } from '../../../ui/button';
import { workspaceClient } from '../../../modules/workspace/view';
import { ErrorText } from '../../../ui/alert';
import { Spinner } from '../../../ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../ui/dialog';
import { errorMessage } from '../../../core/protocol/contract';

export function RemotePortsDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ports = useQuery({
    queryKey: ['workspace', 'remote-ports', projectId],
    queryFn: () => workspaceClient.remotePorts(projectId),
    enabled: open && Boolean(window.dela),
    gcTime: 0,
  });
  const state = ports.data ?? null;
  const working = ports.isFetching;
  const [busyPort, setBusyPort] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? (ports.error ? errorMessage(ports.error) : null);

  const reload = async () => {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: ['workspace', 'remote-ports', projectId] });
  };

  const openPort = async (port: number) => {
    if (!window.dela || busyPort !== null) return;
    setBusyPort(port);
    try {
      await workspaceClient.openRemotePort({ projectId, port });
      await reload();
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusyPort(null);
    }
  };

  const stopPort = async (port: number) => {
    if (!window.dela || busyPort !== null) return;
    setBusyPort(port);
    try {
      await workspaceClient.closeRemotePort({ projectId, port });
      await reload();
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusyPort(null);
    }
  };

  const tunnelOf = (port: number) => state?.tunnels.find((tunnel) => tunnel.remotePort === port);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && busyPort === null) onClose();
      }}
    >
      <DialogContent className="p-5">
        <div className="grid gap-1">
          <DialogTitle className="text-sm">远端端口</DialogTitle>
          <DialogDescription>
            远端监听中的端口；「打开」会建立一条 SSH 隧道并在浏览器访问，停止后隧道关闭。
          </DialogDescription>
        </div>
        <div className="mt-4 grid max-h-80 min-h-0 content-start gap-0.5 overflow-y-auto">
          {state === null && !error ? (
            <p className="flex items-center gap-2 py-4 text-xs text-ink-3" role="status">
              <Spinner size="sm" />
              正在读取远端端口…
            </p>
          ) : (
            state?.ports.map((entry) => {
              const tunnel = tunnelOf(entry.port);
              return (
                <div
                  className="flex min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 text-sm transition-colors duration-base hover:bg-hover"
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
                      <span className="shrink-0 font-mono text-xs text-success tabular-nums">
                        → 127.0.0.1:{tunnel.localPort}
                      </span>
                      <Button
                        disabled={busyPort !== null}
                        onClick={() => void stopPort(entry.port)}
                        size="sm"
                        variant="ghost"
                      >
                        {busyPort === entry.port ? <Spinner /> : <Square />}
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
                      {busyPort === entry.port ? <Spinner /> : <ExternalLink />}
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
                className="flex min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 text-sm transition-colors duration-base hover:bg-hover"
                key={`t-${tunnel.remotePort}`}
              >
                <Globe className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate text-ink-3">
                  端口 {tunnel.remotePort}（进程已退出）
                </span>
                <span className="shrink-0 font-mono text-xs text-success tabular-nums">
                  → 127.0.0.1:{tunnel.localPort}
                </span>
                <Button
                  disabled={busyPort !== null}
                  onClick={() => void stopPort(tunnel.remotePort)}
                  size="sm"
                  variant="ghost"
                >
                  {busyPort === tunnel.remotePort ? <Spinner /> : <Square />}
                  停止
                </Button>
              </div>
            ))}
        </div>
        {error && <ErrorText className="mt-3">{error}</ErrorText>}
        <DialogFooter>
          <Button disabled={working} onClick={() => void reload()} size="sm" variant="ghost">
            {working ? <Spinner /> : <RefreshCw />}
            刷新
          </Button>
          <Button disabled={busyPort !== null} onClick={onClose} size="sm" variant="secondary">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
