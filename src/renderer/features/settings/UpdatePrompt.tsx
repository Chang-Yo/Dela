// 下载完成后的确认弹窗。
//
// 安装会关闭并重新启动 Dela，所以下载完不能自己往下走：必须让用户挑时机。
// 挂在应用层而不是设置页里——下载可能持续几分钟，用户早就离开设置页了。
import { Dialog } from 'radix-ui';
import { Button } from '../../components/ui/button';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';
import { useUpdateState } from './update-state';
import { deferInstall, runUpdateAction } from './update-commands';

export function UpdatePrompt() {
  const state = useUpdateState((snapshot) => snapshot.snapshot);
  const preparing = useUpdateState((snapshot) => snapshot.preparingInstall);
  const dismissedVersion = useUpdateState((snapshot) => snapshot.dismissedVersion);
  const installing = state?.phase === 'installing';
  const busy = preparing || installing;
  const version = state?.version ?? state?.currentVersion;
  const ready = state?.phase === 'ready';
  if (!busy && (!state || !ready || dismissedVersion === version)) return null;

  const dismiss = () => useUpdateState.setState({ dismissedVersion: version ?? null });
  const choose = async (action: () => Promise<boolean>) => {
    if (await action()) dismiss();
  };

  return (
    <Dialog.Root
      // Esc 与点遮罩只是关掉弹窗，不代为决定：那一行仍然留着「安装更新」。
      onOpenChange={(open) => !busy && !open && dismiss()}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={cn(dialogPanel, 'max-w-sm')}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-semibold">
            {busy
              ? installing
                ? '正在打开安装向导'
                : '正在保存工作区'
              : state?.version
                ? `新版本 ${state.version}`
                : '新版本'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-[12px] leading-relaxed text-ink-3">
            {installing
              ? 'Dela 即将退出。请在安装向导中查看进度，完成后保留“运行 Dela”选项并点击“完成”，即可重新打开应用。'
              : preparing
                ? '正在保存笔记、文字草稿、邮件草稿和工作台布局。保存成功后退出 Dela 并打开安装向导。'
                : 'Dela 会先保存工作区，再退出并显示安装向导。终端任务会结束。安装完成后保留“运行 Dela”选项并点击“完成”，即可返回应用。'}
          </Dialog.Description>
          {!busy && (
            <div className="mt-4 flex justify-end gap-2">
              {/* 默认聚焦「下次启动」：下载是在后台跑完的，用户可能正在别处打字，
                回车不该直接把应用关掉。 */}
              <Button autoFocus onClick={() => void choose(deferInstall)} variant="secondary">
                下次启动时提醒
              </Button>
              <Button onClick={() => void choose(() => runUpdateAction('install'))}>
                退出并安装
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
