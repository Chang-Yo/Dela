import { Bird } from 'lucide-react';
import { Toast } from '../../../../ui/toast';
import { MagpieInstallButton, MagpieInstallStatus, useMagpieInstall } from '../magpie-install';
import { StepButton } from '../step-controls';

export function PluginStep({ onDone }: { onDone: () => void }) {
  const magpie = useMagpieInstall();

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">可选插件</h2>
      </header>
      <Toast
        variant="neutral"
        icon={Bird}
        title="magpie"
        description="由 magpie 统一管理 Dela 的模型、MCP 服务器和 Skills。"
        className="w-full items-center gap-4 p-4"
        action={<MagpieInstallButton install={magpie} />}
      >
        <div className="mt-2 empty:hidden">
          <MagpieInstallStatus install={magpie} />
        </div>
      </Toast>
      <StepButton
        state="idle"
        idleLabel="完成配置"
        busyLabel="完成配置"
        successLabel="完成配置"
        type="button"
        onClick={onDone}
      />
    </div>
  );
}
