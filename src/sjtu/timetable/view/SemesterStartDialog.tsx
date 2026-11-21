import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../ui/button';
import { DatePicker } from '../../../ui/date-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../ui/dialog';
import { parseDate, weekStartFor } from './timetable-format';
import { dateKey, formatMonthDay, dayMilliseconds } from '../../../modules/todo/view';
import { errorMessage } from '../../../core/protocol/contract';
import { timetableClient } from './use-timetable';
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
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent aria-describedby={undefined} className="max-w-90 p-5">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle className="tracking-tight">开学日期</DialogTitle>
            <Button
              aria-label="关闭"
              className="-mr-2"
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              <X />
            </Button>
          </DialogHeader>
          <div className="grid gap-2">
            <DatePicker
              aria-label="开学日期"
              autoFocus
              className="w-full"
              onValueChange={(date) => setValue(dateKey(date))}
              placeholder="选择开学第一天"
              value={value ? parseDate(value) : null}
            />
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
      </DialogContent>
    </Dialog>
  );
}
