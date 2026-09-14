import { useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { CalendarRange, Clock, GraduationCap, MapPin, Trash2, User, X } from 'lucide-react';
import type { CalendarEvent } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import {
  calendarToneKey,
  colorFor,
  formatEventRange,
  formatMinuteOfDay,
  formatMonthDay,
  periodBoundary,
  weekdayName,
} from './timetable-format';
import type { CalendarItemDetail } from './WeekCalendar';

// 点击周视图条目后的详情弹窗：排版参考 Google Calendar 的事件卡
// （色点标题 + 小图标信息行）。课程只读；自建事件的删除需二次确认。
export function EventDetailDialog({
  detail,
  onClose,
  onDeleted,
}: {
  detail: CalendarItemDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteEvent = async (event: CalendarEvent) => {
    setDeleting(true);
    setError(null);
    try {
      await window.dela!.timetable.deleteEvent(event.id);
      onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setDeleting(false);
      setConfirming(false);
    }
  };

  const tone =
    detail.kind === 'lesson'
      ? colorFor(detail.lesson.courseCode || detail.lesson.courseName)
      : calendarToneKey(detail.event.color);

  let timeText;
  if (detail.kind === 'event') {
    timeText = formatEventRange(detail.event);
  } else {
    const start = periodBoundary(detail.lesson.startPeriod, 'start');
    const end = periodBoundary(detail.lesson.endPeriod, 'end');
    timeText = detail.date
      ? `${formatMonthDay(detail.date)}（${weekdayName(detail.date)}）${formatMinuteOfDay(start)} – ${formatMinuteOfDay(end)}`
      : `${formatMinuteOfDay(start)} – ${formatMinuteOfDay(end)}`;
  }

  return (
    <DialogPrimitive.Root onOpenChange={(open) => !open && !deleting && onClose()} open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[400px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1 size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--cal-${tone}-bg)` }}
            />
            <DialogPrimitive.Title className="min-w-0 flex-1 break-words text-base font-semibold leading-snug tracking-tight">
              {detail.kind === 'lesson' ? detail.lesson.courseName : detail.event.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button aria-label="关闭" className="-mr-2 -mt-1" size="icon-sm" variant="ghost">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {detail.kind === 'lesson' && (detail.lesson.className || detail.lesson.courseCode) ? (
            <DialogPrimitive.Description className="mt-1 pl-5 text-xs text-muted-foreground">
              {[detail.lesson.className, detail.lesson.courseCode].filter(Boolean).join(' · ')}
            </DialogPrimitive.Description>
          ) : null}
          <div className="mt-4 grid gap-2.5 pl-5 text-[13px]">
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="tabular-nums">{timeText}</span>
            </div>
            {detail.kind === 'event' ? (
              detail.event.location ? (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="break-words">{detail.event.location}</span>
                </div>
              ) : null
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="break-words">
                    {[detail.lesson.classroom, detail.lesson.campus].filter(Boolean).join(' · ') ||
                      '地点未定'}
                  </span>
                </div>
                {detail.lesson.teacher ? (
                  <div className="flex items-start gap-2">
                    <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="break-words">{detail.lesson.teacher}</span>
                  </div>
                ) : null}
                <div className="flex items-start gap-2">
                  <CalendarRange className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{detail.lesson.weeksText}</span>
                </div>
                {detail.lesson.credits != null ? (
                  <div className="flex items-start gap-2">
                    <GraduationCap className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span>{detail.lesson.credits} 学分</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
          {error ? (
            <p className="mt-3 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {/* 底部只保留破坏性操作的确认区；关闭走右上角 X，避免重复入口。 */}
          {detail.kind === 'event' ? (
            <div className="mt-5 flex items-center gap-1.5">
              {confirming ? (
                <>
                  <span className="text-xs text-muted-foreground">确认删除？</span>
                  <Button
                    disabled={deleting}
                    onClick={() => void deleteEvent(detail.event)}
                    size="sm"
                    variant="destructive"
                  >
                    删除
                  </Button>
                  <Button
                    disabled={deleting}
                    onClick={() => setConfirming(false)}
                    size="sm"
                    variant="ghost"
                  >
                    取消
                  </Button>
                </>
              ) : (
                <Button
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirming(true)}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              )}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
