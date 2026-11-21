import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Button } from '../../../ui/button';
import { Calendar } from '../../../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
import { parseDate, weekStartFor } from './timetable-format';
import { dateKey, formatMonthDay, dayMilliseconds } from '../../../modules/todo/view';
import { errorMessage } from '../../../core/protocol/contract';
import { timetableClient } from './use-timetable';
import { ErrorText } from '../../../ui/error-text';

/** 选中的日期先只改按钮上的文字，保存后课表才按新日期重排。 */
export function SemesterStartPicker({
  semester,
  semesterStart,
  open,
  onOpenChange,
  onSaved,
}: {
  semester: string;
  semesterStart: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? semesterStart;
  const firstWeek = value ? weekStartFor(value, 1) : null;

  const close = () => {
    setDraft(null);
    setError(null);
    onOpenChange(false);
  };

  const save = async (next: string) => {
    setSaving(true);
    setError(null);
    try {
      await timetableClient.setSemesterStart({ semester, value: next });
      await onSaved();
      close();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover onOpenChange={(next) => (next ? onOpenChange(true) : close())} open={open}>
      <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-control bg-fill px-2.5 text-xs font-medium text-ink outline-none transition-colors hover:bg-hover-strong focus-visible:ring-3 focus-visible:ring-accent-tint">
        <CalendarRange className="size-3.5 text-ink-3" />
        {value ? `开学 ${formatMonthDay(parseDate(value))}` : '设置开学日期'}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          onValueChange={(date) => setDraft(dateKey(date))}
          value={value ? parseDate(value) : null}
        />
        <p className="px-1 pt-2 text-xs text-ink-3">
          {firstWeek
            ? `第 1 教学周：${formatMonthDay(firstWeek)} – ${formatMonthDay(new Date(firstWeek.getTime() + 6 * dayMilliseconds))}`
            : '选择开学第一天'}
        </p>
        {error ? <ErrorText className="px-1 pt-1">{error}</ErrorText> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={close} size="sm" variant="ghost">
            取消
          </Button>
          <Button disabled={!draft || saving} onClick={() => draft && void save(draft)} size="sm">
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
