import { useEffect, useRef, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { McpServerView } from '../../../../../shared/api';
import { Button } from '../../../../components/ui/button';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { cn } from '../../../../lib/utils';
import { errorText } from '../../../../workspace/store';
import { showToast } from '../../../../app/toasts';
import { SectionHeader } from '../../SectionHeader';
import { SettingsGroup } from '../../SettingsGroup';
import { mcpStatusBadge } from './mcp-logic';
import { McpFormDialog, type McpEditState } from './McpFormDialog';
import { dialogOverlay, dialogPanel } from '../../../../components/ui/motion';
import { PackageMcpGroups } from '../PackageResourceGroups';

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
    const previous = servers;
    setServers(
      (previous ?? []).map((view) => (view.id === server.id ? { ...view, enabled: next } : view)),
    );
    try {
      settle(await window.dela.capability.updateMcpServer(server.id, { enabled: next }));
    } catch (cause) {
      setServers(previous);
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async (id: string) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      settle(await window.dela.capability.refreshMcpServer(id));
    } catch (cause) {
      showToast({ variant: 'error', title: '重连失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      settle(await window.dela.capability.removeMcpServer(id));
      setConfirmId(null);
    } catch (cause) {
      // 删除失败也要让用户看到原因：关闭确认框，错误经 toast 提示。
      setConfirmId(null);
      showToast({ variant: 'error', title: '删除失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  if (!window.dela) {
    return (
      <div className="grid gap-10">
        <SectionHeader title="MCP Server" />
        <p className="text-13 text-ink-3">MCP 管理仅在桌面端可用。</p>
      </div>
    );
  }

  return (
    <div className="grid gap-10">
      <SectionHeader
        action={
          <Button onClick={() => setDialog({ mode: 'create' })} size="sm" variant="secondary">
            <Plus />
            添加服务器
          </Button>
        }
        title="MCP Server"
      />
      {servers !== null && servers.length === 0 && (
        <SettingsGroup>
          <div className="grid gap-1 py-3.5">
            <span className="text-13 font-medium text-ink">还没有 MCP 服务器</span>
            <span className="text-xs leading-relaxed text-ink-3">
              支持以本地命令（如 npx）启动的 stdio 服务器，添加后自动连接并检测工具。
            </span>
          </div>
        </SettingsGroup>
      )}
      {servers !== null && servers.length > 0 && (
        <SettingsGroup>
          <ul className="grid">
            {servers.map((server) => {
              const badge = mcpStatusBadge(server.status, server.toolCount);
              return (
                <li
                  className="flex items-center justify-between gap-4 border-b py-3 last:border-0"
                  key={server.id}
                >
                  <div className="grid min-w-0 gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className="truncate text-13">{server.name}</strong>
                      <span
                        className="inline-flex items-center gap-1.5 text-xs text-ink-3"
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
                      <p className="truncate text-xs text-red" title={server.error}>
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
                      <AlertDialog.Overlay className={dialogOverlay} />
                      <AlertDialog.Content className={cn(dialogPanel, 'max-w-sm')}>
                        <AlertDialog.Title className="text-base font-semibold">
                          删除 {server.name}？
                        </AlertDialog.Title>
                        <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-ink-3">
                          将移除该服务器配置并断开连接，Agent 不再能使用它的工具。此操作不可撤销。
                        </AlertDialog.Description>
                        <div className="mt-4 flex items-center justify-end gap-2">
                          <Button
                            disabled={busy}
                            onClick={() => setConfirmId(null)}
                            variant="ghost"
                          >
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
        </SettingsGroup>
      )}
      <PackageMcpGroups />
      {error && (
        <p className="text-xs text-red" role="alert">
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
