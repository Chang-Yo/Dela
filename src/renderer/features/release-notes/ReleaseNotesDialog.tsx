// 更新后首次启动的「更新内容」弹窗：内容取自 CHANGELOG 每个版本的条目，条数本身就是上限。
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '../../components/ui/button';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';
import { isSmokeTest } from '../onboarding/onboarding-state';
import { takePendingReleaseNotes } from './notes';

export function ReleaseNotesDialog() {
  const [notes] = useState(() =>
    isSmokeTest || !window.dela ? [] : takePendingReleaseNotes(window.dela.version),
  );
  const [open, setOpen] = useState(notes.length > 0);
  if (!notes.length) return null;

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-w-md')}>
          <Dialog.Title className="text-base font-semibold">
            已更新到 {notes[0]!.version}
          </Dialog.Title>
          <Dialog.Description className="sr-only">本次更新的主要变化</Dialog.Description>
          <div className="mt-4 grid max-h-[60vh] gap-4 overflow-y-auto">
            {notes.map((note) => (
              <section className="grid gap-1.5" key={note.version}>
                {notes.length > 1 && (
                  <h3 className="text-xs font-medium text-ink-3">
                    {note.version} · {note.date}
                  </h3>
                )}
                <ul className="grid list-disc gap-1.5 pl-4 text-13 leading-relaxed text-ink-2">
                  {note.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <Button autoFocus onClick={() => setOpen(false)}>
              知道了
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
