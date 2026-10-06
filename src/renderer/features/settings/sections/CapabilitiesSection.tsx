import { useEffect, useState } from 'react';
import { LoaderCircle, Lock } from 'lucide-react';
import type { AgentCapabilityView } from '../../../../shared/api';
import { Switch } from '../../../components/ui/switch';
import { cn } from '../../../lib/utils';
import { SectionHeader } from '../SectionHeader';
import { errorText } from '../../../workspace/store';

/** 按领域聚拢能力（顺序取主进程返回的领域顺序，不依赖同名项相邻）。 */
function groupByDomain(capabilities: AgentCapabilityView[]) {
  const groups = new Map<string, { id: string; label: string; items: AgentCapabilityView[] }>();
  for (const capability of capabilities) {
    const group = groups.get(capability.domain);
    if (group) group.items.push(capability);
    else
      groups.set(capability.domain, {
        id: capability.domain,
        label: capability.domainLabel,
        items: [capability],
      });
  }
  return [...groups.values()];
}

/** 设置 › 内置能力：Agent 可用的内置工具按域开关；关闭即从模型工具表移除。 */
export function CapabilitiesSection() {
  // null 表示尚未读到清单，避免闪烁出错误的“全开”状态。
  const [capabilities, setCapabilities] = useState<AgentCapabilityView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.dela?.capability
      .listBuiltinCapabilities()
      .then(setCapabilities)
      .catch((cause) => setError(errorText(cause)));
  }, []);

  // 即时保存 + 失败回滚（与 Skills / MCP 页签一致）。
  const run = async (operation: () => Promise<AgentCapabilityView[]>) => {
    if (!window.dela || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCapabilities(await operation());
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5" data-setting-id="capabilities">
      <SectionHeader title="内置能力" />
      {/* 作用范围：只影响 Agent 的工具，不影响应用自身的同步与界面。 */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        这些是 Dela 内置的 Agent 能力；关闭后该能力不再提供给模型，应用自身的同步与界面不受影响。
      </p>
      {!window.dela ? (
        <p className="text-sm text-muted-foreground">内置能力配置仅在桌面端可用。</p>
      ) : (
        <>
          {capabilities === null && !error ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" />
              正在读取能力清单…
            </p>
          ) : null}
          {capabilities &&
            groupByDomain(capabilities).map((group) => {
              const toggleable = group.items.filter((item) => !item.lockedReason);
              const enabledCount = toggleable.filter((item) => item.enabled).length;
              const allEnabled = enabledCount === toggleable.length && toggleable.length > 0;
              return (
                <section
                  className="grid gap-2 rounded-xl border bg-card p-5 max-md:p-4"
                  data-setting-id={`capabilities-${group.id}`}
                  key={group.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium">{group.label}</h2>
                    <Switch
                      checked={allEnabled}
                      disabled={busy || toggleable.length === 0}
                      indeterminate={!allEnabled && enabledCount > 0}
                      label={`${group.label}：${allEnabled ? '全部关闭' : '全部开启'}`}
                      onChange={(next) =>
                        void run(() => window.dela!.capability.setBuiltinDomain(group.id, next))
                      }
                    />
                  </div>
                  {/* 与 SystemNotifications 同一分隔策略：标题无边框、行间 border-b。 */}
                  {group.items.map((capability, index) => (
                    <div
                      className={cn(
                        'flex items-start justify-between gap-4 py-1.5',
                        index < group.items.length - 1 && 'border-b pb-3',
                      )}
                      data-setting-id={`capability-${capability.name}`}
                      key={capability.name}
                    >
                      <div className="grid min-w-0 gap-0.5">
                        <span className="truncate font-mono text-sm">{capability.name}</span>
                        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {capability.description}
                        </span>
                        {capability.lockedReason ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground/80">
                            <Lock aria-hidden="true" className="size-3 shrink-0" />
                            常驻能力 · {capability.lockedReason}
                          </span>
                        ) : null}
                      </div>
                      <Switch
                        checked={capability.enabled}
                        disabled={busy || Boolean(capability.lockedReason)}
                        label={capability.name}
                        onChange={(next) =>
                          void run(() =>
                            window.dela!.capability.setBuiltinCapability(capability.name, next),
                          )
                        }
                      />
                    </div>
                  ))}
                </section>
              );
            })}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
