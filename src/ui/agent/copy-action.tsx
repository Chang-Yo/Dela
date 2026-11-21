import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../button';

const COPY_FEEDBACK_MS = 1500;

function CopyAction({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      data-slot="copy-action"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      }}
      title="复制"
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}

export { CopyAction };
