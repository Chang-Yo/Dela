// 设置 › 远程：已保存的 SSH 连接（名称、目的地、私钥与最近一次「测试连接」的结果）。
// 事实全在主进程：这里只做 list / probe / remove 三个通道的展示与调用。
// Dela 不保存密码与密钥本身，凭据由 ssh 从 ~/.ssh 与 agent 读取。
// 新增走「新建项目 › 连接远程目录」的向导（本页只给入口）：连接总是伴随着一个远程项目，
// 让它单独在半路上出现会把「这条连接用来干什么」这一步丢掉。
import { useCallback, useEffect, useState } from 'react';
import { Cloud, Loader2, Plus } from 'lucide-react';
import type { RemoteConnection, RemoteDraft } from '../../../../shared/api';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { remoteAccent } from '../../../navigation/remote-color';
import { RemoteConnectionWizard } from '../../../workspace/remote-wizard';
import { errorText } from '../../../workspace/store';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';

/** 单条连接最近一次「测试连接」的结果；未测过时不显示状态点文字。 */
type ProbeState = { ok: boolean; message: string };

const draftOf = (connection: RemoteConnection): RemoteDraft => ({
  label: connection.label,
  host: connection.host,
  port: connection.port,
  keyPath: connection.keyPath,
});

/** 状态点只有三个取值：没测过是「未连接」，测过按结果分「可用 / 失败」。 */
function statusOf(probe: ProbeState | undefined) {
  if (!probe) return { dot: 'bg-ink-3', label: '未连接', tone: 'text-ink-3' };
  if (probe.ok) return { dot: 'bg-green', label: '可用', tone: 'text-ink' };
  return { dot: 'bg-red', label: '失败', tone: 'text-ink' };
}

export function RemoteSection() {
  const [connections, setConnections] = useState<RemoteConnection[] | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);

  const load = useCallback(() => {
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

  useEffect(() => load(), [load]);

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
        action={
          <Button onClick={() => setWizard(true)} size="sm" variant="secondary">
            <Plus />
            新建连接
          </Button>
        }
        description="经 SSH 使用远端主机上的目录；Dela 只保存目的地与私钥路径，凭据由 ssh 自己读取。"
        title="远程"
      />
      {error && (
        <p className="text-[12px] [overflow-wrap:anywhere] text-red" role="alert">
          {error}
        </p>
      )}
      {connections !== null && connections.length === 0 && (
        <section className="grid gap-2">
          <h2 className="text-base font-semibold">还没有 SSH 连接</h2>
          <p className="text-[13px] leading-relaxed text-ink-3">
            点「新建连接」走一遍向导：填目的地并连上之后，选一个远端目录作为项目——连接就是从这里来的。
          </p>
        </section>
      )}
      {connections !== null && connections.length > 0 && (
        <section className="grid">
          {connections.map((connection) => {
            const probe = probes[connection.id];
            const status = statusOf(probe);
            const target = `${connection.host}${
              connection.port === null ? '' : `:${connection.port}`
            }`;
            return (
              <SettingRow
                description={
                  <>
                    <span className="block truncate" title={target}>
                      {target} · {connection.keyPath ?? 'ssh 默认'}
                    </span>
                    {/* 探测消息是诊断信息：成功时弱化，失败时用红色承担「为什么连不上」。 */}
                    {probe && (
                      <span
                        className={cn('block [overflow-wrap:anywhere]', !probe.ok && 'text-red')}
                        role={probe.ok ? 'status' : 'alert'}
                      >
                        {probe.message}
                      </span>
                    )}
                  </>
                }
                key={connection.id}
                leading={
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-card"
                    style={{ background: remoteAccent(connection.id, 'bg') }}
                  >
                    <Cloud
                      className="size-4"
                      strokeWidth={1.8}
                      style={{ color: remoteAccent(connection.id, 'text') }}
                    />
                  </span>
                }
                settingId={`remote-${connection.id}`}
                title={connection.label}
              >
                <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                  <span className={cn('flex items-center gap-1.5 text-[12px]', status.tone)}>
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 shrink-0 rounded-full', status.dot)}
                    />
                    {status.label}
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
                  {/* 删除是破坏性动作，永远只是次要入口：ghost 无底色、文字再暗一档。 */}
                  <Button
                    className="text-ink-3 hover:text-ink"
                    disabled={busyId !== null}
                    onClick={() => void remove(connection)}
                    size="sm"
                    variant="ghost"
                  >
                    删除
                  </Button>
                </div>
              </SettingRow>
            );
          })}
        </section>
      )}
      {/* 向导自带对话框与进行中状态；关闭后重列一次，因为它可能在半路就存下了连接。 */}
      <RemoteConnectionWizard
        open={wizard}
        onClose={() => {
          setWizard(false);
          void load();
        }}
        onImported={() => {
          setWizard(false);
          void load();
        }}
      />
    </div>
  );
}
