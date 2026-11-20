import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../ui/button';
import { weekStartFor } from './timetable-format';
import { formatMonthDay, dayMilliseconds } from '../../../modules/todo/view';
import { dialogIn, overlayFade } from '../../../ui/lib/motion';
import { errorMessage } from '../../../core/protocol/contract';
import { timetableClient } from './use-timetable';
import { cn } from '../../../ui/lib/cn';
import { ErrorText } from '../../../ui/error-text';

export function SemesterStartDialog({
  semester,
  semesterStart,
  onClose,
  onSaved,
}: {
  semester: string;
  semesterStart: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(semesterStart ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstWeek = value ? weekStartFor(value, 1) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value) return setError('请选择开学第一天');
    setSaving(true);
    setError(null);
    try {
      await timetableClient.setSemesterStart({ semester, value });
      onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
      setSaving(false);
    }
  };

  return (
    <div
      aria-modal="true"
      className={cn(overlayFade, 'fixed inset-0 z-overlay grid place-items-center bg-scrim p-4')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <form
        className={cn(
          dialogIn,
          'flex w-full max-w-90 flex-col gap-4 rounded-window bg-surface p-5 shadow-overlay',
        )}
        onSubmit={(event) => void submit(event)}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">开学日期</h2>
          <Button
            aria-label="关闭"
            className="-mr-2"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
        <div className="grid gap-2">
          <div className="flex h-8 w-full items-center rounded-control bg-field px-2.5 text-sm text-ink shadow-hairline transition-[background-color,box-shadow] duration-base focus-within:bg-surface focus-within:shadow-focus">
            <input
              aria-label="开学日期"
              autoFocus
              className="w-full bg-transparent text-sm tabular-nums outline-none"
              onChange={(event) => setValue(event.target.value)}
              type="date"
              value={value}
            />
          </div>
          {firstWeek ? (
            <p className="text-xs text-ink-3">
              第 1 教学周：{formatMonthDay(firstWeek)} –{' '}
              {formatMonthDay(new Date(firstWeek.getTime() + 6 * dayMilliseconds))}
            </p>
          ) : null}
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            取消
          </Button>
          <Button disabled={saving} type="submit">
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </form>
    </div>
  );
}
