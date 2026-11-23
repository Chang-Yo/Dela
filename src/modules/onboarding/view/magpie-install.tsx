// 引导的插件页与 设置 › 通用 共用的 magpie 插件安装按钮和结果提示。
import { useMutation } from '@tanstack/react-query';
import { Check, ExternalLink } from 'lucide-react';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { ErrorText } from '../../../ui/error-text';
import { Spinner } from '../../../ui/spinner';
import { onboardingClient } from './client';

const MAGPIE_SITE = 'https://usemagpie.ai';

export function useMagpieInstall() {
  return useMutation({ mutationFn: () => onboardingClient.installMagpiePlugin() });
}

type MagpieInstall = ReturnType<typeof useMagpieInstall>;

export function MagpieInstallButton({ install }: { install: MagpieInstall }) {
  if (install.data === true) {
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
      disabled={install.isPending || !window.dela}
      onClick={() => install.mutate()}
    >
      {install.isPending && <Spinner />}
      {install.isPending ? '安装中…' : install.isIdle ? '安装' : '重试'}
    </Button>
  );
}

export function MagpieInstallStatus({ install }: { install: MagpieInstall }) {
  if (install.data === true) {
    return (
      <p className="text-xs leading-relaxed text-ink-3">
        在 magpie 的 Agents 页面打开 Dela 即可连接。
      </p>
    );
  }
  if (install.data === false) {
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
  if (install.isError) return <ErrorText>{errorMessage(install.error)}</ErrorText>;
  return null;
}
