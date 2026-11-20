// 聊天里「检查并发送邮件」的弹窗，由外壳注入 ChatTabSource.mailDialog。
import { useQuery } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { MailComposer } from './MailComposer';
import { leaveComposer } from './compose-close';
import { errorMessage } from '../../../core/protocol/contract';
import { dialogIn, dialogOverlay } from '../../../ui/lib/motion';
import { cn } from '../../../ui/lib/cn';
import { mailClient } from './use-mail';

export function MailDraftDialog({
  draftId,
  onClose,
  onSent,
}: {
  draftId: string;
  onClose: () => void;
  onSent: (warning: string | null) => void;
}) {
  // 打开草稿会把附件复制进写信暂存区：弹窗内只读一次，关闭即丢弃缓存。
  const opened = useQuery({
    queryKey: ['mail', 'openDraft', draftId],
    queryFn: async () => {
      const mail = await mailClient.state();
      if (!mail.account) throw new Error('请先在邮箱页面配置账号');
      return { draft: await mailClient.openDraft(draftId), address: mail.account.address };
    },
    staleTime: Infinity,
    gcTime: 0,
  });
  const state = opened.data;

  const close = () => {
    if (leaveComposer(onClose)) onClose();
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && close()} open>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            dialogIn,
            'fixed inset-4 z-overlay flex flex-col overflow-hidden rounded-window bg-surface shadow-overlay',
          )}
        >
          <Dialog.Title className="sr-only">检查邮件草稿</Dialog.Title>
          {!state && (
            <p
              role={opened.isError ? 'alert' : 'status'}
              className={cn('p-4 text-sm', opened.isError ? 'text-danger' : 'text-ink-3')}
            >
              {opened.isError ? errorMessage(opened.error) : '正在打开草稿…'}
            </p>
          )}
          {state && (
            <MailComposer
              accountAddress={state.address}
              draft={state.draft}
              embedded
              key={state.draft.id}
              onClose={close}
              onSent={(warning) => onSent(warning ?? null)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
