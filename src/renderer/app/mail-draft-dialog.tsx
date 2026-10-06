// 邮件草稿检查弹窗（chat 域 ChatTabSource.mailDialog 的注入实现）：读取草稿
// （mail.openDraft）、账号校验、未保存关闭守卫（leaveComposer 语义）与发送都在本组件内
// 完成；包装旧 features/mail/MailComposer 为自包含弹窗（旧 ChatThread 内联的 Dialog 段）。
import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import type { PreparedEmail } from '../../shared/api';
import { MailComposer } from '../features/mail/MailComposer';
import { leaveComposer } from '../features/mail/compose-close';
import { errorText } from '../workspace/store';
import type { MailDraftDialogProps } from '../content/chat';

export function MailDraftDialog({ draftId, onClose, onSent }: MailDraftDialogProps) {
  const [state, setState] = useState<{ draft: PreparedEmail; address: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState(null);
    setHint('正在打开草稿…');
    void (async () => {
      try {
        const dela = window.dela;
        if (!dela) throw new Error('邮件草稿仅在桌面端可用');
        const mail = await dela.mail.getState();
        if (!mail.account) throw new Error('请先在邮箱页面配置账号');
        const prepared = await dela.mail.openDraft(draftId);
        if (active) {
          setState({ draft: prepared, address: mail.account.address });
          setHint(null);
        }
      } catch (cause) {
        if (active) setHint(errorText(cause));
      }
    })();
    return () => {
      active = false;
    };
  }, [draftId]);

  const close = () => {
    if (leaveComposer(onClose)) onClose();
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && close()} open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
        >
          <Dialog.Title className="sr-only">检查邮件草稿</Dialog.Title>
          {hint && !state && (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              {hint}
            </p>
          )}
          {state && (
            <MailComposer
              accountAddress={state.address}
              draft={state.draft}
              embedded
              key={state.draft.id}
              onClose={close}
              onDirtyChange={() => {}}
              onSent={(warning) => onSent(warning ?? null)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
