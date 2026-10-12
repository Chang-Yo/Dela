// 下载完成后的确认弹窗。
//
// 装完系统会结束 Dela 且不保证自动重启，所以下载完不能自己往下走：必须让用户挑时机。
// 挂在应用层而不是设置页里——下载可能持续几分钟，用户早就离开设置页了。
import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '../../components/ui/button';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';
import { useUpdateState } from './update-state';
import { deferInstall, runUpdateAction } from './update-commands';

export function UpdatePrompt() {
  const state = useUpdateState((snapshot) => snapshot.snapshot);
  const preparing = useUpdateState((snapshot) => snapshot.preparingInstall);
  const installing = state?.phase === 'installing';
  const busy = preparing || installing;
  // 只提示一次：用户表过态就不再拦着他。离开 ready 阶段后重置，给下一次更新让路。
  const [answered, setAnswered] = useState(false);
  const ready = state?.phase === 'ready';
  useEffect(() => {
    if (!ready) setAnswered(false);
  }, [ready]);
  if (!busy && (!state || !ready || answered)) return null;

  const choose = (action: () => Promise<unknown>) => {
    setAnswered(true);
    void action();
  };

  return (
    <Dialog.Root
      // Esc 与点遮罩只是关掉弹窗，不代为决定：那一行仍然留着「安装更新」。
      onOpenChange={(open) => !busy && !open && setAnswered(true)}
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
                ? '正在安装更新'
                : '正在保存工作区'
              : state?.version
                ? `新版本 ${state.version}`
                : '新版本'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-[12px] leading-relaxed text-ink-3">
            {busy
              ? '保存成功后才会安装，安装期间 Dela 会关闭。'
              : '安装前会保存工作区内容，安装期间 Dela 会关闭。也可以下次启动时再提醒。'}
          </Dialog.Description>
          {!busy && (
            <div className="mt-4 flex justify-end gap-2">
              {/* 默认聚焦「下次启动」：下载是在后台跑完的，用户可能正在别处打字，
                回车不该直接把应用关掉。 */}
              <Button autoFocus onClick={() => choose(deferInstall)} variant="secondary">
                下次启动时提醒
              </Button>
              <Button onClick={() => choose(() => runUpdateAction('install'))}>现在安装</Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
