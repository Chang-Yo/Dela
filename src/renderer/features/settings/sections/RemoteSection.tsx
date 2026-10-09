// 设置 › 远程：已保存的 SSH 连接（label、目的地、端口、私钥或「ssh 默认」）。
// 事实全在主进程：这里只做 list / probe / remove 三个通道的展示与调用。
// Dela 不保存密码与密钥本身，凭据由 ssh 从 ~/.ssh 与 agent 读取。
import { useEffect, useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import type { RemoteConnection, RemoteDraft } from '../../../../shared/api';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { errorText } from '../../../workspace/store';
import { SectionHeader } from '../SectionHeader';

/** 单条连接最近一次「测试连接」的结果；未测过时不显示状态点文字。 */
type ProbeState = { ok: boolean; message: string };

const draftOf = (connection: RemoteConnection): RemoteDraft => ({
  label: connection.label,
  host: connection.host,
  port: connection.port,
  keyPath: connection.keyPath,
});

export function RemoteSection() {
  const [connections, setConnections] = useState<RemoteConnection[] | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remotes = window.dela?.remotes;
    if (!remotes) {
      setConnections([]);
      return;
    }
    let live = true;
    void remotes.list().then(
      (list) => {
        if (live) setConnections(list);
      },
      (cause) => {
        if (!live) return;
        setConnections([]);
        setError(errorText(cause));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const test = async (connection: RemoteConnection) => {
    const remotes = window.dela?.remotes;
    if (!remotes || busyId) return;
    setBusyId(connection.id);
    setError(null);
    try {
      const result = await remotes.probe(draftOf(connection));
      setProbes((prev) => ({
        ...prev,
        [connection.id]: { ok: result.ok, message: result.message },
      }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (connection: RemoteConnection) => {
    const remotes = window.dela?.remotes;
    if (!remotes || busyId) return;
    setBusyId(connection.id);
    setError(null);
    try {
      await remotes.remove(connection.id);
      setConnections((prev) => (prev ?? []).filter((item) => item.id !== connection.id));
      setProbes((prev) => {
        const next = { ...prev };
        delete next[connection.id];
        return next;
      });
    } catch (cause) {
      // main 的拒绝原因（如「该连接下还有项目，请先移除项目」）原样显示。
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid gap-10">
      <SectionHeader
        description="经 SSH 使用远端主机上的目录；Dela 只保存目的地与私钥路径，凭据由 ssh 自己读取。"
        title="远程"
      />
      {error && (
        <p className="text-[12px] [overflow-wrap:anywhere] text-red" role="alert">
          {error}
        </p>
      )}
      {connections !== null && connections.length === 0 && (
        <p className="text-[12px] text-ink-3">
          还没有已保存的连接；在「新建项目」里选「连接远程目录」即可添加。
        </p>
      )}
      <ul className="grid">
        {(connections ?? []).map((connection) => {
          const probe = probes[connection.id];
          const state = probe?.ok ? '可用' : '未连接';
          return (
            <li
              className="grid gap-2 border-b py-3 last:border-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6"
              data-setting-id={`remote-${connection.id}`}
              key={connection.id}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-card bg-hover-2">
                  <Cloud className="size-4 text-ink-3" strokeWidth={1.8} />
                </span>
                <div className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-[13px]">{connection.label}</strong>
                  <span className="truncate text-[12px] text-ink-3">
                    {connection.host}
                    {connection.port === null ? '' : `:${connection.port}`} ·{' '}
                    {connection.keyPath ?? 'ssh 默认'}
                  </span>
                  {probe && (
                    <span
                      className={cn(
                        'text-[12px] [overflow-wrap:anywhere]',
                        probe.ok ? 'text-ink-3' : 'text-red',
                      )}
                      role={probe.ok ? 'status' : 'alert'}
                    >
                      {probe.message}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-start gap-2 md:justify-end">
                {/* 状态点语义沿用仓库约定：绿=可用，灰=未连接。 */}
                <span
                  className={cn(
                    'flex min-w-[72px] items-center gap-1.5 text-[12px] max-md:min-w-0',
                    probe?.ok ? 'text-ink' : 'text-ink-3',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      probe?.ok ? 'bg-green' : 'bg-ink-3',
                    )}
                  />
                  {state}
                </span>
                <Button
                  disabled={busyId !== null}
                  onClick={() => void test(connection)}
                  size="sm"
                  variant="secondary"
                >
                  {busyId === connection.id && <Loader2 className="animate-spin" />}
                  测试连接
                </Button>
                <Button
                  disabled={busyId !== null}
                  onClick={() => void remove(connection)}
                  size="sm"
                  variant="ghost"
                >
                  删除
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
