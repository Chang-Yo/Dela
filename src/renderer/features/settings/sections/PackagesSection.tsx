import { useEffect, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { FolderOpen, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type {
  PackageResourceToggles,
  PackageSettings,
  PiPackageView,
} from '../../../../shared/api';
import { Button } from '../../../components/ui/button';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { cn } from '../../../lib/utils';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';
import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { PackageInstallDialog } from './PackageInstallDialog';
import { RuntimeStatus } from './PackageRuntimeStatus';

const resourceLabels: Record<keyof PackageResourceToggles, string> = {
  extensions: '扩展',
  skills: 'Skills',
  prompts: '提示模板',
};

const typeLabels: Record<PiPackageView['type'], string> = {
  npm: 'npm',
  git: 'git',
  local: '本地',
};

/** 设置 › Pi Packages：总开关（含 npm 运行时）、包的安装、启停、按类开关、更新与卸载。 */
export function PackagesSection() {
  const [settings, setSettings] = useState<PackageSettings | null>(null);
  const [packages, setPackages] = useState<PiPackageView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const api = window.dela?.packages;
    if (!api) return;
    void api.settings().then(setSettings);
    const unsubscribe = api.onSettingsChanged(setSettings);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!settings?.enabled) return;
    void window.dela?.packages
      .list()
      .then(setPackages)
      .catch((cause) =>
        showToast({ variant: 'error', title: '读取失败', description: errorText(cause) }),
      );
  }, [settings?.enabled]);

  const run = async (title: string, operation: () => Promise<PiPackageView[]>) => {
    if (busy) return;
    setBusy(true);
    try {
      setPackages(await operation());
    } catch (cause) {
      showToast({ variant: 'error', title, description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const toggleMaster = async (next: boolean) => {
    const api = window.dela?.packages;
    if (!api) return;
    try {
      setSettings(await (next ? api.enable() : api.disable()));
    } catch (cause) {
      showToast({ variant: 'error', title: '无法开启 Pi Packages', description: errorText(cause) });
    }
  };

  if (!window.dela) {
    return (
      <div className="grid gap-10">
        <SectionHeader title="Pi Packages" />
        <p className="text-13 text-ink-3">Pi Packages 仅在桌面端可用。</p>
      </div>
    );
  }

  const enabled = settings?.enabled ?? false;
  const installing =
    settings?.runtime.status === 'installing' || settings?.runtime.status === 'checking';

  return (
    <div className="grid gap-10">
      <SectionHeader
        action={
          enabled ? (
            <Button onClick={() => setInstallOpen(true)} size="sm" variant="secondary">
              <Plus />
              安装包
            </Button>
          ) : undefined
        }
        description="安装 Pi 社区的扩展、Skills 与提示模板。扩展与 Dela 同权限运行，只安装你信任的来源。"
        title="Pi Packages"
      />

      <SettingsGroup>
        <div className="flex items-center justify-between gap-4 py-3.5">
          <div className="grid min-w-0 gap-1">
            <span className="text-13 font-medium text-ink">启用 Pi Packages</span>
            {settings && <RuntimeStatus settings={settings} />}
          </div>
          <Switch
            checked={enabled || installing}
            disabled={!settings || installing}
            label="启用 Pi Packages"
            onChange={(next) => void toggleMaster(next)}
          />
        </div>
        {enabled && settings && (
          <div className="flex items-center justify-between gap-4 border-t py-3.5">
            <div className="grid min-w-0 gap-1">
              <span className="text-13 font-medium text-ink">npm 源</span>
              <span className="text-xs text-ink-3">校园网下官方源较慢时可切换到镜像。</span>
            </div>
            <div className="flex shrink-0 gap-1">
              {(['npmjs', 'npmmirror'] as const).map((registry) => (
                <Button
                  aria-pressed={settings.registry === registry}
                  key={registry}
                  onClick={() => void window.dela?.packages.setRegistry(registry).then(setSettings)}
                  size="sm"
                  variant={settings.registry === registry ? 'secondary' : 'ghost'}
                >
                  {registry === 'npmjs' ? '官方' : 'npmmirror'}
                </Button>
              ))}
            </div>
          </div>
        )}
      </SettingsGroup>

      {enabled && packages !== null && packages.length === 0 && (
        <SettingsGroup>
          <div className="grid gap-1 py-3.5">
            <span className="text-13 font-medium text-ink">还没有安装包</span>
            <span className="text-xs leading-relaxed text-ink-3">
              支持 npm、git 与本地目录。安装后默认关闭，确认来源后再启用。
            </span>
          </div>
        </SettingsGroup>
      )}

      {enabled && packages !== null && packages.length > 0 && (
        <SettingsGroup>
          <ul className="grid">
            {packages.map((item) => (
              <li className="grid gap-2.5 border-b py-3.5 last:border-0" key={item.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="grid min-w-0 gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className="truncate text-13">{item.name}</strong>
                      {item.version && <span className="text-xs text-ink-3">{item.version}</span>}
                      <span className="rounded-chip bg-hover px-1.5 py-0.5 text-2xs text-ink-2">
                        {typeLabels[item.type]}
                      </span>
                    </div>
                    <span className="truncate font-mono text-xs text-ink-3" title={item.source}>
                      {item.source}
                    </span>
                    {item.description && (
                      <span className="text-xs leading-relaxed text-ink-2">{item.description}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={item.enabled}
                      disabled={busy}
                      label={`启用 ${item.name}`}
                      onChange={(next) =>
                        void run('保存失败', () => window.dela!.packages.setEnabled(item.id, next))
                      }
                    />
                    {item.type !== 'local' && (
                      <Button
                        aria-label={`更新 ${item.name}`}
                        disabled={busy}
                        onClick={() =>
                          void run('更新失败', () => window.dela!.packages.update(item.id))
                        }
                        size="icon-sm"
                        variant="ghost"
                      >
                        <RefreshCw />
                      </Button>
                    )}
                    <Button
                      aria-label={`打开 ${item.name} 所在目录`}
                      disabled={!item.installedPath}
                      onClick={() =>
                        void window.dela!.packages.reveal(item.id).catch((cause) =>
                          showToast({
                            variant: 'error',
                            title: '无法打开目录',
                            description: errorText(cause),
                          }),
                        )
                      }
                      size="icon-sm"
                      variant="ghost"
                    >
                      <FolderOpen />
                    </Button>
                    <Button
                      aria-label={`卸载 ${item.name}`}
                      disabled={busy}
                      onClick={() => setConfirmId(item.id)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {(Object.keys(resourceLabels) as (keyof PackageResourceToggles)[]).map(
                    (kind) =>
                      item.counts[kind] > 0 && (
                        <label
                          className={cn(
                            'flex items-center gap-1.5 text-xs',
                            item.enabled ? 'text-ink-2' : 'text-ink-3',
                          )}
                          key={kind}
                        >
                          <input
                            checked={item.resources[kind]}
                            className="size-3 accent-[var(--ink-2)]"
                            disabled={busy}
                            onChange={(event) =>
                              void run('保存失败', () =>
                                window.dela!.packages.setResources(item.id, {
                                  ...item.resources,
                                  [kind]: event.target.checked,
                                }),
                              )
                            }
                            type="checkbox"
                          />
                          {resourceLabels[kind]} {item.counts[kind]}
                        </label>
                      ),
                  )}
                  {item.counts.themes > 0 && (
                    <span className="text-xs text-ink-3" title="终端主题在 Dela 中不生效">
                      主题 {item.counts.themes}（不适用）
                    </span>
                  )}
                </div>

                <PackageProvidesList item={item} />

                {item.diagnostics.length > 0 && (
                  <ul className="grid gap-0.5">
                    {item.diagnostics.map((message) => (
                      <li className="text-xs [overflow-wrap:anywhere] text-red" key={message}>
                        {message}
                      </li>
                    ))}
                  </ul>
                )}

                <AlertDialog.Root
                  onOpenChange={(open) => !open && !busy && setConfirmId(null)}
                  open={confirmId === item.id}
                >
                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className={dialogOverlay} />
                    <AlertDialog.Content className={cn(dialogPanel, 'max-w-sm')}>
                      <AlertDialog.Title className="text-base font-semibold">
                        卸载 {item.name}？
                      </AlertDialog.Title>
                      <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-ink-3">
                        {item.type === 'local'
                          ? '只取消登记，不删除本地目录。'
                          : '将删除这个包的安装目录。'}
                        正在进行的对话结束本轮后不再加载它。
                      </AlertDialog.Description>
                      <div className="mt-4 flex items-center justify-end gap-2">
                        <Button disabled={busy} onClick={() => setConfirmId(null)} variant="ghost">
                          取消
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run('卸载失败', () => window.dela!.packages.remove(item.id)).then(
                              () => setConfirmId(null),
                            )
                          }
                          variant="destructive"
                        >
                          {busy ? (
                            <>
                              <LoaderCircle className="animate-spin" />
                              卸载中…
                            </>
                          ) : (
                            '卸载'
                          )}
                        </Button>
                      </div>
                    </AlertDialog.Content>
                  </AlertDialog.Portal>
                </AlertDialog.Root>
              </li>
            ))}
          </ul>
        </SettingsGroup>
      )}

      {installOpen && (
        <PackageInstallDialog
          onClose={() => setInstallOpen(false)}
          onInstalled={(views) => {
            setPackages(views);
            setInstallOpen(false);
          }}
          runtimeReady={settings?.runtime.status === 'ready'}
        />
      )}
    </div>
  );
}

/**
 * 包实际提供了什么：Skills、提示模板、扩展命令、工具与 MCP 服务器的名字。逐项开关在各自的分区
 * （Skills、自定义指令、MCP Server）里，这里只做总览，让用户知道装进来的东西去了哪儿。
 */
function PackageProvidesList({ item }: { item: PiPackageView }) {
  const { provides } = item;
  const rows: [string, string[]][] = [
    ['Skills', provides.skills.map((skill) => skill.name)],
    ['提示模板', provides.prompts.map((prompt) => `/${prompt.name}`)],
    ['命令', provides.commands.map((command) => `/${command.name}`)],
    ['工具', provides.tools],
    ['MCP', provides.mcpServers.map((server) => server.name)],
  ];
  const visible = rows.filter(([, names]) => names.length > 0);
  const pending = !provides.extensionsInspected && item.counts.extensions > 0;
  if (!visible.length && !pending) return null;
  return (
    <dl
      aria-label={`${item.name} 提供的内容`}
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
    >
      {visible.map(([label, names]) => (
        <div className="contents" key={label}>
          <dt className="text-ink-3">{label}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere] text-ink-2">{names.join(' · ')}</dd>
        </div>
      ))}
      {pending && (
        <div className="contents">
          <dt className="text-ink-3">扩展</dt>
          <dd className="text-ink-3">
            {item.enabled && item.resources.extensions
              ? '读取失败，见下方诊断'
              : '启用后显示它注册的命令、工具与 MCP 服务器'}
          </dd>
        </div>
      )}
    </dl>
  );
}
