import { useEffect, useState } from 'react';
import { LoaderCircle, Lock } from 'lucide-react';
import type { AgentCapabilityView } from '../../../../shared/api';
import { Switch } from '../../../components/ui/switch';
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
    <div className="grid gap-10" data-setting-id="capabilities">
      <SectionHeader
        description="关闭后不再提供给模型；应用自身的同步与界面不受影响。"
        title="内置能力"
      />
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
          {capabilities && (
            <div className="grid gap-10">
              {groupByDomain(capabilities).map((group) => {
                const toggleable = group.items.filter((item) => !item.lockedReason);
                const enabledCount = toggleable.filter((item) => item.enabled).length;
                const allEnabled = enabledCount === toggleable.length && toggleable.length > 0;
                return (
                  <section
                    className="grid gap-2"
                    data-setting-id={`capabilities-${group.id}`}
                    key={group.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold">{group.label}</h2>
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
                    {group.items.map((capability) => (
                      <div
                        className="flex items-start justify-between gap-4 border-b py-3 last:border-0"
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
            </div>
          )}
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
