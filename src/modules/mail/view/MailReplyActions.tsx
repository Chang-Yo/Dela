import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check } from 'lucide-react';
import type { ChatReplyActions } from '../../../app/module';
import { Button } from '../../../ui/button';
import { showToast } from '../../../ui/toast';
import { MailDraftDialog } from './MailDraftDialog';
import { mailClient } from './use-mail';

/** `dela prepare_email` 经 bash 调用，输出里带 "draftId":"<uuid>"。 */
export const MailReplyActions: ChatReplyActions = ({ tools }) => {
  const draftIds = [
    ...new Set(
      tools.flatMap((result) =>
        result.name === 'bash' &&
        (result.input as { command?: string } | null)?.command?.includes('prepare_email')
          ? [...(result.output?.text ?? '').matchAll(/"draftId":"([0-9a-f-]{36})"/g)].map(
              (match) => match[1]!,
            )
          : [],
      ),
    ),
  ];
  return draftIds.map((draftId) => <PreparedDraftButton key={draftId} draftId={draftId} />);
};

function PreparedDraftButton({ draftId }: { draftId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const sentKey = ['mail', 'preparedSent', draftId];
  const sent = useQuery({
    queryKey: sentKey,
    queryFn: () => mailClient.preparedSent(draftId),
  }).data;

  if (sent)
    return (
      <Button variant="outline" className="mb-2 mt-1 [&_svg]:size-3.5" disabled>
        <Check />
        邮件已发送
      </Button>
    );
  return (
    <>
      <Button
        variant="outline"
        className="mb-2 mt-1 [&_svg]:size-3.5"
        disabled={sent === undefined}
        onClick={() => setOpen(true)}
      >
        <ArrowUpRight />
        检查并发送邮件
      </Button>
      {open && (
        <MailDraftDialog
          draftId={draftId}
          onClose={() => setOpen(false)}
          onSent={(warning) => {
            setOpen(false);
            queryClient.setQueryData(sentKey, true);
            void mailClient.markPreparedSent(draftId);
            if (warning) showToast({ variant: 'neutral', title: warning });
          }}
        />
      )}
    </>
  );
}
