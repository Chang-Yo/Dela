import { useEffect, useState } from 'react';
import { LoaderCircle, Lock, SlidersHorizontal } from 'lucide-react';
import type { AgentCapabilityView } from '../../../../shared/api';
import { Button } from '../../../components/ui/button';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { SearchConfigDialog } from './SearchConfigDialog';

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

/** 设置 › 内置能力：Agent 可用的内置工具按域开关；关闭即从模型工具表移除。
 *  WebSearch 的搜索服务注册入口在「网络」域头部，弹窗管理。 */
export function CapabilitiesSection() {
  // null 表示尚未读到清单，避免闪烁出错误的“全开”状态。
  const [capabilities, setCapabilities] = useState<AgentCapabilityView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void window.dela?.capability
        .listBuiltinCapabilities()
        .then((list) => {
          if (current === request) setCapabilities(list);
        })
        .catch((cause) => {
          if (current === request) setError(errorText(cause));
        });
    };
    const unsubscribe = window.dela?.capability.onWebSearchChanged?.(refresh);
    refresh();
    return () => {
      unsubscribe?.();
      request++;
    };
  }, []);

  // 即时保存 + 失败回滚（与 Skills / MCP 页签一致）。
  const run = async (operation: () => Promise<AgentCapabilityView[]>) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      setCapabilities(await operation());
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-10" data-setting-id="capabilities">
      <SectionHeader title="内置能力" />
      {!window.dela ? (
        <p className="text-13 text-ink-3">内置能力配置仅在桌面端可用。</p>
      ) : (
        <>
          {capabilities === null && !error ? (
            <SettingsGroup>
              <p className="flex items-center gap-2 py-3.5 text-xs text-ink-3" role="status">
                <LoaderCircle className="size-4 animate-spin" />
                正在读取能力清单…
              </p>
            </SettingsGroup>
          ) : null}
          {capabilities && (
            <div className="grid gap-10">
              {groupByDomain(capabilities).map((group) => {
                const toggleable = group.items.filter((item) => !item.lockedReason);
                const enabledCount = toggleable.filter((item) => item.enabled).length;
                const allEnabled = enabledCount === toggleable.length && toggleable.length > 0;
                // 常驻原因整组只说明一次；锁定行不再渲染假开关。
                const lockedReason = group.items.find((item) => item.lockedReason)?.lockedReason;
                return (
                  <SettingsGroup
                    action={
                      <div className="flex items-center gap-1">
                        {group.id === 'web' && (
                          <Button
                            aria-label="配置搜索服务"
                            title="配置搜索服务"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setSearchOpen(true)}
                          >
                            <SlidersHorizontal className="size-4" strokeWidth={1.8} />
                          </Button>
                        )}
                        {toggleable.length > 0 && (
                          <Switch
                            checked={allEnabled}
                            disabled={busy}
                            indeterminate={!allEnabled && enabledCount > 0}
                            label={`${group.label}：${allEnabled ? '全部关闭' : '全部开启'}`}
                            onChange={(next) =>
                              void run(() =>
                                window.dela!.capability.setBuiltinDomain(group.id, next),
                              )
                            }
                          />
                        )}
                      </div>
                    }
                    description={
                      lockedReason ? (
                        <span className="flex items-center gap-1.5">
                          <Lock aria-hidden="true" className="size-3 shrink-0" />
                          常驻能力 · {lockedReason}
                        </span>
                      ) : undefined
                    }
                    key={group.id}
                    settingId={`capabilities-${group.id}`}
                    title={group.label}
                  >
                    {group.items.map((capability) => (
                      <div
                        className="flex items-start justify-between gap-4 border-b py-3 last:border-0"
                        data-setting-id={`capability-${capability.name}`}
                        key={capability.name}
                      >
                        <div className="grid min-w-0 gap-0.5">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate text-13 font-medium">{capability.label}</span>
                            <span className="truncate font-mono text-xs text-ink-3">
                              {capability.name}
                            </span>
                          </div>
                          <span className="line-clamp-2 text-xs leading-relaxed text-ink-3">
                            {capability.description}
                          </span>
                        </div>
                        {capability.lockedReason ? (
                          // 常驻徽标在容器底色上要再跳一级，否则和容器同色看不见。
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-hover-2 px-2 py-1 text-xs text-ink-3">
                            <Lock aria-hidden="true" className="size-3" />
                            常驻
                          </span>
                        ) : (
                          <Switch
                            checked={capability.enabled}
                            disabled={busy}
                            label={capability.label}
                            onChange={(next) =>
                              void run(() =>
                                window.dela!.capability.setBuiltinCapability(capability.name, next),
                              )
                            }
                          />
                        )}
                      </div>
                    ))}
                  </SettingsGroup>
                );
              })}
            </div>
          )}
          {error && (
            <p className="text-xs text-red" role="alert">
              {error}
            </p>
          )}
          {searchOpen && <SearchConfigDialog onClose={() => setSearchOpen(false)} />}
        </>
      )}
    </div>
  );
}
