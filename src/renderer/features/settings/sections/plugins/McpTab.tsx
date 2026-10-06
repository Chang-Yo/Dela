import { useEffect, useRef, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { McpServerView } from '../../../../../shared/api';
import { Button } from '../../../../components/ui/button';
import { Switch } from '../../../../components/ui/switch';
import { cn } from '../../../../lib/utils';
import { errorText } from '../../../../workspace/store';
import { mcpStatusBadge } from './mcp-logic';
import { McpFormDialog, type McpEditState } from './McpFormDialog';

/** 设置 › MCP Server：stdio 服务器的增删改、启停与连接状态（视图由主进程持有，页面只做镜像与操作）。 */
export function McpTab() {
  // null 表示尚未读到列表，避免闪烁出错误的空态。
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<McpEditState>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // 写入列表；connecting 是中间态：500ms 后自动再拉一次（至多 followUps 次），
  // 让“添加/重连 → 连接中 → 已连接/失败”在页面上落定，不做常驻轮询。
  const settle = (views: McpServerView[], followUps = 0) => {
    setServers(views);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!window.dela) return;
    if (views.some((view) => view.status === 'connecting') && followUps < 2) {
      timerRef.current = window.setTimeout(() => {
        void window.dela?.capability
          .listMcpServers()
          .then((next) => settle(next, followUps + 1))
          .catch((cause) => setError(errorText(cause)));
      }, 500);
    }
  };

  useEffect(() => {
    void window.dela?.capability
      .listMcpServers()
      .then((views) => settle(views))
      .catch((cause) => setError(errorText(cause)));
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  // 启停即时保存 + 失败回滚（与其他设置页签一致）。
  const toggle = async (server: McpServerView, next: boolean) => {
    if (!window.dela || busy) return;
    setBusy(true);
    setError(null);
    const previous = servers;
    setServers(
      (previous ?? []).map((view) => (view.id === server.id ? { ...view, enabled: next } : view)),
    );
    try {
      settle(await window.dela.capability.updateMcpServer(server.id, { enabled: next }));
    } catch (cause) {
      setServers(previous);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async (id: string) => {
    if (!window.dela || busy) return;
    setBusy(true);
    setError(null);
    try {
      settle(await window.dela.capability.refreshMcpServer(id));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.dela || busy) return;
    setBusy(true);
    setError(null);
    try {
      settle(await window.dela.capability.removeMcpServer(id));
      setConfirmId(null);
    } catch (cause) {
      // 删除失败也要让用户看到原因：关闭确认框，页内报错。
      setConfirmId(null);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!window.dela) {
    return <p className="text-sm text-muted-foreground">MCP 管理仅在桌面端可用。</p>;
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button onClick={() => setDialog({ mode: 'create' })} size="sm">
          <Plus />
          添加服务器
        </Button>
      </div>
      {servers !== null && servers.length === 0 && (
        <section className="grid gap-2 rounded-xl border border-dashed bg-card p-5">
          <h2 className="text-sm font-medium">还没有 MCP 服务器</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            当前支持 stdio 形态的服务器：以本地命令（如 npx）启动的进程，为 Agent
            提供外部工具与资源。添加后自动连接并检测可发现的工具。
          </p>
        </section>
      )}
      {servers !== null && servers.length > 0 && (
        <ul className="grid">
          {servers.map((server) => {
            const badge = mcpStatusBadge(server.status, server.toolCount);
            return (
              <li
                className="flex min-h-16 items-center justify-between gap-4 border-b last:border-0"
                key={server.id}
              >
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <strong className="truncate text-sm">{server.name}</strong>
                    <span
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                      title={server.error ?? undefined}
                    >
                      {badge.spin ? (
                        <LoaderCircle className={cn('size-3 animate-spin', badge.dotClass)} />
                      ) : (
                        <span className={cn('size-2 shrink-0 rounded-full', badge.dotClass)} />
                      )}
                      {badge.label}
                    </span>
                  </div>
                  {/* error=红点 + 摘要可见、完整消息悬停可见（依赖状态说明原因，§4.4）。 */}
                  {server.status === 'error' && server.error ? (
                    <p className="truncate text-xs text-destructive" title={server.error}>
                      {server.error}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={server.enabled}
                    disabled={busy}
                    label={`启用 ${server.name}`}
                    onChange={(next) => void toggle(server, next)}
                  />
                  <Button
                    aria-label={`重连 ${server.name}`}
                    disabled={busy || !server.enabled}
                    onClick={() => void reconnect(server.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <RefreshCw />
                  </Button>
                  <Button
                    aria-label={`编辑 ${server.name}`}
                    disabled={busy}
                    onClick={() => setDialog({ mode: 'edit', server })}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Pencil />
                  </Button>
                  <Button
                    aria-label={`删除 ${server.name}`}
                    disabled={busy}
                    onClick={() => setConfirmId(server.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
                <AlertDialog.Root
                  onOpenChange={(open) => !open && !busy && setConfirmId(null)}
                  open={confirmId === server.id}
                >
                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
                    <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
                      <AlertDialog.Title className="text-base font-semibold">
                        删除 {server.name}？
                      </AlertDialog.Title>
                      <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        将移除该服务器配置并断开连接，Agent 不再能使用它的工具。此操作不可撤销。
                      </AlertDialog.Description>
                      <div className="mt-4 flex items-center justify-end gap-2">
                        <Button disabled={busy} onClick={() => setConfirmId(null)} variant="ghost">
                          取消
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => void remove(server.id)}
                          variant="destructive"
                        >
                          {busy ? '删除中…' : '删除'}
                        </Button>
                      </div>
                    </AlertDialog.Content>
                  </AlertDialog.Portal>
                </AlertDialog.Root>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {dialog && (
        <McpFormDialog
          editing={dialog}
          onClose={() => setDialog(null)}
          onSaved={(views) => settle(views)}
        />
      )}
    </div>
  );
}
