import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText } from 'lucide-react';
import type { SkillView } from '../../../core/protocol/capabilities';
import { ToastCard } from '../../../ui/toast';
import { Button } from '../../../ui/button';
import { DownloadProgress } from '../../../ui/download-progress';
import { StepButton } from './step-controls';
import { ErrorText } from '../../../ui/alert';
import { capabilitiesClient } from '../../chat/view';
import { errorMessage } from '../../../core/protocol/contract';

const skillsQueryKey = ['onboarding', 'skills'];

export function CapabilitySetup({
  onDone,
  children,
}: {
  onDone: () => void;
  children: (content: ReactNode, footer: ReactNode) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const cancelRequested = useRef(false);

  const skillsQuery = useQuery({
    queryKey: skillsQueryKey,
    queryFn: () => capabilitiesClient.listSkills(),
    refetchInterval: (query) =>
      busy !== null || query.state.data?.some((skill) => skill.dependency?.status === 'installing')
        ? 1000
        : false,
  });
  const skills = skillsQuery.data ?? null;
  const error = actionError ?? (skillsQuery.error ? errorMessage(skillsQuery.error) : null);

  const enable = async (skill: SkillView) => {
    if (busy || !window.dela) return;
    setBusy(skill.name);
    setActionError(null);
    cancelRequested.current = false;
    const install = async () => {
      const next =
        skill.dependency?.status === 'ready'
          ? await capabilitiesClient.setSkillEnabled({ id: skill.id, enabled: true })
          : await capabilitiesClient.installSkillDependencies(skill.name);
      queryClient.setQueryData(skillsQueryKey, next);
    };
    try {
      await install();
    } catch (cause) {
      if (!cancelRequested.current) setActionError(errorMessage(cause));
      await skillsQuery.refetch();
    }
    setBusy(null);
  };

  const cancel = async (name: string) => {
    cancelRequested.current = true;
    try {
      await capabilitiesClient.cancelSkillInstallation(name);
    } catch (cause) {
      cancelRequested.current = false;
      setActionError(errorMessage(cause));
    }
  };

  const content = (
    <div className="grid gap-7">
      <h2 className="text-2xl font-semibold tracking-tight">能力拓展</h2>
      <div className="grid gap-3">
        {skills === null && !error && (
          <p role="status" className="text-sm text-ink-3">
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
                      <Check className="size-4 text-success" />
                      已启用
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy && (busy !== skill.name || dependency.status === 'ready')}
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
                      <DownloadProgress
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
                    <ErrorText className="mt-2">{dependency.error}</ErrorText>
                  )}
              </ToastCard>
            );
          })}
      </div>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          <span>{error}</span>
          {skills === null && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setActionError(null);
                void skillsQuery.refetch();
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
      state="idle"
      idleLabel="完成配置"
      busyLabel="完成配置"
      successLabel="完成配置"
      type="button"
      onClick={onDone}
    />
  );
  return children(content, footer);
}
