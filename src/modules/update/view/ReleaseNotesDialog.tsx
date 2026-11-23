// 更新后首次启动的「更新内容」弹窗：内容取自 CHANGELOG 每个版本的条目，原样展示不截断。
import { useState } from 'react';
import { Button } from '../../../ui/button';
import { takePendingReleaseNotes } from './notes';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../ui/dialog';

export function ReleaseNotesDialog() {
  const [notes] = useState(() => (window.dela ? takePendingReleaseNotes(window.dela.version) : []));
  const [open, setOpen] = useState(notes.length > 0);
  if (!notes.length) return null;

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent>
        <DialogTitle>已更新到 {notes[0]!.version}</DialogTitle>
        <DialogDescription className="sr-only">本次更新的主要变化</DialogDescription>
        <div className="mt-4 grid max-h-[60vh] gap-4 overflow-y-auto">
          {notes.map((note) => (
            <section className="grid gap-1.5" key={note.version}>
              {notes.length > 1 && (
                <h3 className="text-xs font-medium text-ink-3">
                  {note.version} · {note.date}
                </h3>
              )}
              <ul className="grid list-disc gap-1.5 pl-4 text-sm leading-relaxed text-ink-2">
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
      </DialogContent>
    </Dialog>
  );
}
