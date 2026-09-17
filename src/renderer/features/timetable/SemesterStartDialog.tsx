import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { DateInput } from './DateInput';
import { formatMonthDay, dayMilliseconds, weekStartFor } from './timetable-format';

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
      await window.dela!.timetable.setSemesterStart(semester, value);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid animate-in fade-in place-items-center bg-black/30 p-4 backdrop-blur-[2px] duration-200"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <form
        className="flex w-full max-w-[360px] animate-in fade-in zoom-in-95 flex-col gap-4 rounded-xl border bg-card p-5 shadow-2xl duration-200"
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
          <div className="border-input dark:bg-input/30 flex h-9 w-full items-center rounded-md border bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]">
            <DateInput autoFocus label="开学日期" onChange={setValue} value={value} />
          </div>
          {firstWeek ? (
            <p className="text-xs text-muted-foreground">
              第 1 教学周：{formatMonthDay(firstWeek)} –{' '}
              {formatMonthDay(new Date(firstWeek.getTime() + 6 * dayMilliseconds))}
            </p>
          ) : null}
        </div>
        {error ? (
          <p className="break-words text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
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
