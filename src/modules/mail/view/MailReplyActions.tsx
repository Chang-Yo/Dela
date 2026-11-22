import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { ChatReplyActions } from '../../../app/module';
import { Button } from '../../../ui/button';
import { showToast } from '../../../ui/toast';
import { MailDraftDialog } from './MailDraftDialog';

/** `dela prepare_email` 经 bash 调用，输出里带 "draftId":"<uuid>"。 */
export const MailReplyActions: ChatReplyActions = ({ tools }) => {
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
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

  return (
    <>
      {draftIds.map((draftId) => (
        <Button
          key={draftId}
          variant="outline"
          className="mb-2 mt-1 [&_svg]:size-3.5"
          onClick={() => setOpenDraftId(draftId)}
        >
          <ArrowUpRight />
          检查并发送邮件
        </Button>
      ))}
      {openDraftId && (
        <MailDraftDialog
          draftId={openDraftId}
          onClose={() => setOpenDraftId(null)}
          onSent={(warning) => {
            setOpenDraftId(null);
            if (warning) showToast({ variant: 'neutral', title: warning });
          }}
        />
      )}
    </>
  );
};
