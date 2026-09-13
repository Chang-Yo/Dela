import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { CalendarEventColor } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { dateKey, eventPalette, timeInput } from './timetable-format';

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
  const [startDate, setStartDate] = useState(() => dateKey(draft.start));
  const [startTime, setStartTime] = useState(() => timeInput(draft.start));
  const [endDate, setEndDate] = useState(() => dateKey(draft.end));
  const [endTime, setEndTime] = useState(() => timeInput(draft.end));
  const [location, setLocation] = useState('');
  // 默认石墨中性色，与自动配色的课程区分；选了候选色则随事件保存。
  const [color, setColor] = useState<CalendarEventColor>('slate');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError('请输入事件名称');
    const startAt = startDate && startTime ? new Date(`${startDate}T${startTime}`) : null;
    const endAt = endDate && endTime ? new Date(`${endDate}T${endTime}`) : null;
    if (!startAt || !endAt) return setError('请选择开始和结束时间');
    if (endAt <= startAt) return setError('结束时间必须晚于开始时间');
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
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
        className="flex w-full max-w-[400px] animate-in fade-in zoom-in-95 flex-col gap-4 rounded-xl border bg-card p-5 shadow-2xl duration-200"
        onSubmit={(event) => void submit(event)}
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
        <div className="grid gap-3">
          <Input
            autoFocus
            className="h-10 border-0 bg-transparent px-0 text-[15px] font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：小组讨论"
            value={title}
          />
          <div className="grid divide-y overflow-hidden rounded-lg border">
            <div className="flex h-11 items-center gap-2 px-3 transition-colors has-[:focus-visible]:bg-accent/60">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">开始</span>
              {/* Electron 界面语言默认 en-US，lang 强制日期时间按中文格式渲染。 */}
              <Input
                aria-label="开始日期"
                className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none accent-foreground focus-visible:ring-0 dark:bg-transparent"
                lang="zh-CN"
                onChange={(event) => setStartDate(event.target.value)}
                type="date"
                value={startDate}
              />
              <Input
                aria-label="开始时间"
                className="h-8 w-[88px] border-0 bg-transparent px-0 shadow-none accent-foreground focus-visible:ring-0 dark:bg-transparent"
                lang="zh-CN"
                onChange={(event) => setStartTime(event.target.value)}
                type="time"
                value={startTime}
              />
            </div>
            <div className="flex h-11 items-center gap-2 px-3 transition-colors has-[:focus-visible]:bg-accent/60">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">结束</span>
              <Input
                aria-label="结束日期"
                className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none accent-foreground focus-visible:ring-0 dark:bg-transparent"
                lang="zh-CN"
                onChange={(event) => setEndDate(event.target.value)}
                type="date"
                value={endDate}
              />
              <Input
                aria-label="结束时间"
                className="h-8 w-[88px] border-0 bg-transparent px-0 shadow-none accent-foreground focus-visible:ring-0 dark:bg-transparent"
                lang="zh-CN"
                onChange={(event) => setEndTime(event.target.value)}
                type="time"
                value={endTime}
              />
            </div>
            <div className="flex h-11 items-center gap-2 px-3 transition-colors has-[:focus-visible]:bg-accent/60">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">地点</span>
              <Input
                aria-label="地点"
                className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                maxLength={120}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="会议室、教室或线上"
                value={location}
              />
            </div>
            <div className="flex h-11 items-center gap-2 px-3 transition-colors">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">颜色</span>
              <div className="flex flex-1 items-center gap-1.5">
                {eventPalette.map(({ key, label }) => (
                  <button
                    aria-label={label}
                    aria-pressed={color === key}
                    className={cn(
                      'size-5 rounded-full outline-offset-2 transition-transform hover:scale-110',
                      color === key && 'ring-2 ring-ring ring-offset-2 ring-offset-card',
                    )}
                    key={key}
                    onClick={() => setColor(key)}
                    style={{ backgroundColor: `var(--cal-${key}-bg)` }}
                    title={label}
                    type="button"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
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
    </div>
  );
}
