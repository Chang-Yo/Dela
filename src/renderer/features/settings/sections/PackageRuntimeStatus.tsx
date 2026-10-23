import { LoaderCircle } from 'lucide-react';
import type { PackageSettings } from '../../../../shared/api';
import { Button } from '../../../components/ui/button';

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** npm 运行时一行状态：设置页总开关与引导页的能力选项共用。 */
export function RuntimeStatus({ settings }: { settings: PackageSettings }) {
  const runtime = settings.runtime;
  if (runtime.status === 'checking')
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-3" role="status">
        <LoaderCircle className="size-3 animate-spin" />
        正在检测本机 npm
      </span>
    );
  if (runtime.status === 'installing')
    return (
      <span
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3"
        role="status"
      >
        <LoaderCircle className="size-3 animate-spin" />
        {runtime.phase}
        {runtime.received !== undefined &&
          ` ${megabytes(runtime.received)}${runtime.total ? ` / ${megabytes(runtime.total)}` : ''}`}
        <Button
          onClick={() => void window.dela?.packages.cancelRuntimeInstall()}
          className="h-6"
          size="sm"
          variant="ghost"
        >
          取消
        </Button>
      </span>
    );
  if (runtime.status === 'error')
    return (
      <span className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
        {runtime.error}
      </span>
    );
  if (runtime.status === 'ready')
    return (
      <span className="text-xs text-ink-3">
        npm {runtime.version}（{runtime.origin === 'system' ? '本机' : 'Dela 下载'}）
      </span>
    );
  return (
    <span className="text-xs text-ink-3">
      开启时检测本机 npm，没有则下载 Node 运行时（约 30 MB）。
    </span>
  );
}
