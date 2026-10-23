import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, FileText, Package } from 'lucide-react';
import type { SkillView } from '../../../shared/capabilities';
import type { PackageSettings } from '../../../shared/packages';
import { RuntimeStatus } from '../settings/sections/PackageRuntimeStatus';
import { ToastCard } from '@/components/ui/beautifului/atoms/Toast';
import { Button } from '../../components/ui/button';
import { DownloadProgressRow } from '../../components/download-progress';
import { errorText } from '../../workspace/store';
import { WizardShell } from './WizardShell';
import { StepButton } from './steps/step-controls';

/** 新用户向导末页与老用户升级入口共用，组件安装继续使用现有 Skills API。 */
export function CapabilitySetup({
  onDone,
  children,
}: {
  onDone: () => void;
  children?: (content: ReactNode, footer: ReactNode) => ReactNode;
}) {
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = useRef(false);
  const cancelRequested = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await window.dela!.capability.listSkills();
      if (active.current) setSkills(next);
    } catch (cause) {
      if (active.current) setError(errorText(cause));
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
    };
  }, [refresh]);

  const installing =
    busy !== null || skills?.some((skill) => skill.dependency?.status === 'installing');
  useEffect(() => {
    if (!installing) return;
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [installing, refresh]);

  const enable = async (skill: SkillView) => {
    if (busy || !window.dela) return;
    setBusy(skill.name);
    setError(null);
    cancelRequested.current = false;
    try {
      const next =
        skill.dependency?.status === 'ready'
          ? await window.dela.capability.setSkillEnabled(skill.id, true)
          : await window.dela.capability.installSkillDependencies(skill.name);
      if (active.current) setSkills(next);
    } catch (cause) {
      if (active.current && !cancelRequested.current) setError(errorText(cause));
      await refresh();
    } finally {
      if (active.current) setBusy(null);
    }
  };

  const cancel = async (name: string) => {
    cancelRequested.current = true;
    try {
      await window.dela!.capability.cancelSkillInstallation(name);
    } catch (cause) {
      cancelRequested.current = false;
      if (active.current) setError(errorText(cause));
    }
  };

  const finish = async () => {
    if (saving || !window.dela) return;
    setSaving(true);
    setError(null);
    try {
      await window.dela.capability.completeSetup();
      if (active.current) onDone();
    } catch (cause) {
      if (active.current) {
        setError(errorText(cause));
        setSaving(false);
      }
    }
  };

  const content = (
    <div className="grid gap-7">
      <h2 className="text-2xl font-semibold tracking-tight">能力拓展</h2>
      <div className="grid gap-3">
        {skills === null && !error && (
          <p role="status" className="text-13 text-ink-3">
            正在检查组件…
          </p>
        )}
        {skills
          ?.filter((skill) => skill.dependency)
          .map((skill) => {
            const dependency = skill.dependency!;
            // 面向用户的名字只在此处映射：设置页仍按目录名列出，与其他 Skill 一致。
            const displayName = skill.name === 'document-reading' ? '文档读取' : skill.name;
            const downloading =
              dependency.status === 'installing' ||
              (busy === skill.name && dependency.status !== 'ready');
            const ready = dependency.status === 'ready' && skill.enabled;
            const total = dependency.total;
            const received = dependency.received ?? 0;
            return (
              <ToastCard
                key={skill.name}
                variant="neutral"
                icon={skill.name === 'document-reading' ? FileText : undefined}
                title={displayName}
                description={
                  skill.name === 'document-reading'
                    ? '读取 Word、Excel、PowerPoint 和 PDF。'
                    : skill.description
                }
                className="w-full flex-wrap items-center gap-4 p-4"
                action={
                  ready ? (
                    <span className="flex items-center gap-1.5 text-xs text-ink-3">
                      <Check className="size-4 text-green" />
                      已启用
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        saving || (!!busy && (busy !== skill.name || dependency.status === 'ready'))
                      }
                      onClick={() => void (downloading ? cancel(skill.name) : enable(skill))}
                    >
                      {downloading
                        ? '取消'
                        : dependency.status === 'ready'
                          ? busy === skill.name
                            ? '启用中…'
                            : '启用'
                          : dependency.status === 'error'
                            ? '重试'
                            : '安装并启用'}
                    </Button>
                  )
                }
              >
                {downloading && (
                  <div className="mt-3 grid gap-1.5" role="status">
                    <span className="text-xs text-ink-3">
                      {dependency.phase ?? '正在准备组件…'}
                    </span>
                    {total ? (
                      <DownloadProgressRow
                        barClassName="flex-1"
                        label={`${displayName} 下载进度`}
                        received={received}
                        total={total}
                      />
                    ) : null}
                  </div>
                )}
                {dependency.status === 'error' &&
                  dependency.error &&
                  dependency.error !== error && (
                    <p role="alert" className="mt-2 break-words text-xs text-red">
                      {dependency.error}
                    </p>
                  )}
              </ToastCard>
            );
          })}
        <PackagesCard disabled={saving} />
      </div>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-13 text-red">
          <span>{error}</span>
          {skills === null && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setError(null);
                void refresh();
              }}
            >
              重试
            </Button>
          )}
        </div>
      )}
    </div>
  );
  const footer = (
    <StepButton
      state={saving ? 'busy' : 'idle'}
      idleLabel="完成配置"
      busyLabel="正在保存…"
      successLabel="完成配置"
      type="button"
      onClick={() => void finish()}
    />
  );
  return children ? (
    children(content, footer)
  ) : (
    <WizardShell step={0} stepCount={0} footer={footer}>
      {content}
    </WizardShell>
  );
}

/** Pi Packages 总开关：与设置页同一个 enable 流程（先找本机 npm，没有就下载 Node 运行时）。 */
function PackagesCard({ disabled }: { disabled: boolean }) {
  const [settings, setSettings] = useState<PackageSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.dela?.packages;
    if (!api) return;
    void api.settings().then(setSettings);
    return api.onSettingsChanged(setSettings);
  }, []);

  const runtime = settings?.runtime.status;
  const working = runtime === 'checking' || runtime === 'installing';
  const enable = async () => {
    setError(null);
    try {
      setSettings(await window.dela!.packages.enable());
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <ToastCard
      variant="neutral"
      icon={Package}
      title="Pi Packages"
      description="安装 Pi 社区的扩展、Skills 与提示模板。扩展与 Dela 同权限运行。"
      className="w-full flex-wrap items-center gap-4 p-4"
      action={
        settings?.enabled ? (
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            <Check className="size-4 text-green" />
            已启用
          </span>
        ) : (
          <Button
            disabled={disabled || !settings || working}
            onClick={() => void enable()}
            size="sm"
            variant="outline"
          >
            {working ? '准备中…' : runtime === 'error' ? '重试' : '启用'}
          </Button>
        )
      }
    >
      {settings && (working || settings.enabled) && (
        <div className="mt-3">
          <RuntimeStatus settings={settings} />
        </div>
      )}
      {error && runtime !== 'error' && (
        <p role="alert" className="mt-2 break-words text-xs text-red">
          {error}
        </p>
      )}
      {runtime === 'error' && (
        <div className="mt-2">
          <RuntimeStatus settings={settings!} />
        </div>
      )}
    </ToastCard>
  );
}
