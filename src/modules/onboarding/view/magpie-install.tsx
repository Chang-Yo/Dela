// 引导的插件页与 设置 › 通用 共用的 magpie 插件安装按钮和结果提示。
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink } from 'lucide-react';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { ErrorText } from '../../../ui/error-text';
import { Spinner } from '../../../ui/spinner';
import { onboardingClient } from './client';

const MAGPIE_SITE = 'https://usemagpie.ai';
const magpieKey = ['onboarding', 'magpie-plugin'];

export function useMagpieInstall() {
  const queryClient = useQueryClient();
  const installing = useIsMutating({ mutationKey: magpieKey }) > 0;
  const status = useQuery({
    queryKey: magpieKey,
    queryFn: () => onboardingClient.magpiePluginStatus(),
    enabled: Boolean(window.dela) && !installing,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const mutation = useMutation({
    mutationKey: magpieKey,
    mutationFn: () => onboardingClient.installMagpiePlugin(),
    onMutate: () => queryClient.cancelQueries({ queryKey: magpieKey }),
    onSuccess: (installed) => {
      queryClient.setQueryData(magpieKey, installed ? 'installed' : 'unavailable');
      void queryClient.invalidateQueries({ queryKey: magpieKey });
    },
  });
  return { status, mutation, installing };
}

type MagpieInstall = ReturnType<typeof useMagpieInstall>;

export function MagpieInstallButton({ install }: { install: MagpieInstall }) {
  const { status, mutation, installing } = install;
  const busy = installing || status.isFetching;
  if (!installing && !status.isError && status.data === 'installed') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-3">
        <Check className="size-4 text-success" />
        已安装
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || !window.dela}
      onClick={() => mutation.mutate()}
    >
      {busy && <Spinner />}
      {busy ? '处理中…' : '安装'}
    </Button>
  );
}

export function MagpieInstallStatus({ install }: { install: MagpieInstall }) {
  const { status, mutation, installing } = install;
  if (installing) return null;
  if (status.isError) return <ErrorText>检测失败：{errorMessage(status.error)}</ErrorText>;
  if (status.data === 'installed') return null;
  if (status.data === 'unavailable') {
    return (
      <div className="grid gap-2">
        <ErrorText>
          没有找到 magpie。请先安装；已经安装的话，在 magpie 的 设置 › 命令行 里把它加入 PATH。
        </ErrorText>
        <Button
          className="justify-self-start"
          size="sm"
          variant="outline"
          onClick={() => window.open(MAGPIE_SITE)}
          type="button"
        >
          <ExternalLink aria-hidden="true" />
          打开 usemagpie.ai
        </Button>
      </div>
    );
  }
  if (mutation.isError) return <ErrorText>{errorMessage(mutation.error)}</ErrorText>;
  return null;
}
