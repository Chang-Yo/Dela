// 设置页各分区里「来自 Pi Packages」的那一组：自定义指令列包的 prompt 模板与扩展命令，MCP Server 列包注册的
// 服务器。数据都来自 packages.list() 的 provides，总开关关闭时整组不出现。
import { useEffect, useState } from 'react';
import { Package, Server, Terminal } from 'lucide-react';
import type { PiPackageView } from '../../../../shared/api';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { SettingsGroup } from '../SettingsGroup';

/** 已装的包；总开关关闭或桌面端以外为空表。 */
export function usePiPackages() {
  const [packages, setPackages] = useState<PiPackageView[]>([]);
  useEffect(() => {
    const api = window.dela?.packages;
    if (!api) return;
    let alive = true;
    void api
      .settings()
      .then((settings) => (settings.enabled ? api.list() : []))
      .then((list) => alive && setPackages(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return [packages, setPackages] as const;
}

/** 包的整体状态说明：未启用、或关掉了某一类资源时，这一组里的条目都不会进会话。 */
function packageNote(item: PiPackageView, kind: 'prompts' | 'extensions'): string {
  if (!item.enabled) return 'Pi Package · 未启用';
  if (!item.resources[kind])
    return kind === 'prompts' ? 'Pi Package · 已关闭提示模板' : 'Pi Package · 已关闭扩展';
  return 'Pi Package';
}

const rowIcon = 'grid size-8 shrink-0 place-items-center rounded-card bg-hover-2';

/** 自定义指令分区：每个包一组，prompt 模板可逐个开关，扩展命令只读（Pi 不支持单独停用命令）。 */
export function PackageCommandGroups() {
  const [packages, setPackages] = usePiPackages();
  const [busy, setBusy] = useState(false);
  const toggle = async (name: string, enabled: boolean) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      setPackages(await window.dela.packages.setPromptEnabled(name, enabled));
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };
  return packages
    .filter(
      (item) =>
        item.provides.prompts.length > 0 ||
        item.provides.commands.length > 0 ||
        (!item.provides.extensionsInspected && item.counts.extensions > 0),
    )
    .map((item) => (
      <SettingsGroup description={packageNote(item, 'prompts')} key={item.id} title={item.name}>
        <ul className="grid">
          {item.provides.prompts.map((prompt) => (
            <li
              className="flex items-center justify-between gap-4 border-b py-3 last:border-0"
              key={`prompt:${prompt.name}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className={rowIcon}>
                  <Package className="size-4 text-ink-3" strokeWidth={1.8} />
                </span>
                <div className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-13">
                    /{prompt.name}
                    {prompt.argumentHint && (
                      <span className="ml-1.5 font-normal text-ink-3">{prompt.argumentHint}</span>
                    )}
                  </strong>
                  <span className="truncate text-xs text-ink-3">
                    提示模板{prompt.description && ` · ${prompt.description}`}
                  </span>
                </div>
              </div>
              <Switch
                checked={!item.disabledPrompts.includes(prompt.name)}
                disabled={busy || !item.enabled || !item.resources.prompts}
                label={`启用 ${prompt.name}`}
                onChange={(next) => void toggle(prompt.name, next)}
              />
            </li>
          ))}
          {item.provides.commands.map((command) => (
            <li
              className="flex items-center gap-3 border-b py-3 last:border-0"
              key={`command:${command.name}`}
            >
              <span className={rowIcon}>
                <Terminal className="size-4 text-ink-3" strokeWidth={1.8} />
              </span>
              <div className="grid min-w-0 gap-0.5">
                <strong className="truncate text-13">/{command.name}</strong>
                <span className="truncate text-xs text-ink-3">
                  扩展命令{command.description && ` · ${command.description}`}
                </span>
              </div>
            </li>
          ))}
          {!item.provides.extensionsInspected && item.counts.extensions > 0 && (
            <li className="py-3 text-xs text-ink-3">
              {item.enabled && item.resources.extensions
                ? '扩展注册的命令读取失败，见 Pi Packages 里的诊断。'
                : '启用包与扩展后显示扩展注册的命令。'}
            </li>
          )}
        </ul>
      </SettingsGroup>
    ));
}

/** MCP Server 分区：包里的扩展注册的服务器，只读；在会话里由 Pi 的 MCP 扩展连接。 */
export function PackageMcpGroups() {
  const [packages] = usePiPackages();
  return packages
    .filter((item) => item.provides.mcpServers.length > 0)
    .map((item) => (
      <SettingsGroup
        description={`${packageNote(item, 'extensions')} · 打开会话时连接`}
        key={item.id}
        title={item.name}
      >
        <ul className="grid">
          {item.provides.mcpServers.map((server) => (
            <li className="flex items-center gap-3 border-b py-3 last:border-0" key={server.name}>
              <span className={rowIcon}>
                <Server className="size-4 text-ink-3" strokeWidth={1.8} />
              </span>
              <div className="grid min-w-0 gap-0.5">
                <strong className="truncate text-13">{server.name}</strong>
                <span className="truncate font-mono text-xs text-ink-3" title={server.detail}>
                  {server.detail}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </SettingsGroup>
    ));
}
