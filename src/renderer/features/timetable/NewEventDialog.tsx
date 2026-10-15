import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { CalendarEventColor } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { DateTimeStepper } from '../todo/DateTimeStepper';
import { EventColorRow } from './EventColorRow';
import { roundToMinute } from './timetable-format';
import { sheetUp } from '../../components/ui/motion';
import { errorText } from '../../workspace/store';
import { cn } from '../../lib/utils';

const HOUR_MS = 3_600_000;

export function NewEventDialog({
  draft,
  onClose,
  onCreated,
}: {
  draft: { start: Date; end: Date };
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState(() => roundToMinute(draft.start));
  // 结束默认比开始晚一小时；之后调整开始时整体平移结束，保持时长不变。
  const [endAt, setEndAt] = useState<Date>(() => {
    const start = roundToMinute(draft.start);
    const end = roundToMinute(draft.end);
    return end.getTime() > start.getTime() ? end : new Date(start.getTime() + HOUR_MS);
  });
  const [location, setLocation] = useState('');
  // 默认石墨中性色，与自动配色的课程区分；选了候选色则随事件保存。
  const [color, setColor] = useState<CalendarEventColor>('slate');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeStart = (next: Date) => {
    const delta = next.getTime() - startAt.getTime();
    setStartAt(next);
    setEndAt((prev) => new Date(prev.getTime() + delta));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError('请输入事件名称');
    if (endAt.getTime() <= startAt.getTime()) return setError('结束时间必须晚于开始时间');
    setSaving(true);
    setError(null);
    try {
      await window.dela!.timetable.createEvent({
        title: title.trim(),
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        location: location.trim(),
        color,
      });
      onCreated();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  // 底部滑出面板与新建待办共用同一套结构与动画。
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      role="dialog"
    >
      <div aria-hidden="true" className="absolute inset-0" onMouseDown={onClose} />
      <section
        aria-label="新建事件"
        className={cn(
          sheetUp,
          'absolute inset-x-0 bottom-0 mx-auto flex max-h-[calc(100%-2rem)] w-full max-w-xl flex-col overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-overlay max-md:px-4',
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">新建事件</h2>
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
        <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <Input
            autoFocus
            className="h-10 px-0 text-15 font-medium"
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：小组讨论"
            value={title}
            variant="ghost"
          />
          <div className="grid divide-y overflow-hidden rounded-card border border-line">
            <div className="flex min-h-11 items-center gap-2 px-3">
              <span className="w-8 shrink-0 text-xs text-ink-3">开始</span>
              <div className="flex-1">
                <DateTimeStepper label="开始时间" onChange={changeStart} value={startAt} />
              </div>
            </div>
            <div className="flex min-h-11 items-center gap-2 px-3">
              <span className="w-8 shrink-0 text-xs text-ink-3">结束</span>
              <div className="flex-1">
                <DateTimeStepper label="结束时间" onChange={setEndAt} value={endAt} />
              </div>
            </div>
            <div className="flex h-11 items-center gap-2 px-3 transition-colors has-[:focus-visible]:bg-hover">
              <span className="w-8 shrink-0 text-xs text-ink-3">地点</span>
              <Input
                aria-label="地点"
                className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                maxLength={120}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="会议室、教室或线上"
                value={location}
              />
            </div>
            <EventColorRow className="transition-colors" onColorChange={setColor} value={color} />
          </div>
          {error ? (
            <p className="break-words text-xs text-red" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} variant="ghost">
              取消
            </Button>
            <Button disabled={saving} type="submit">
              {saving ? '创建中…' : '创建'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
