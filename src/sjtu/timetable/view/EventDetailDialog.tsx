import { CalendarRange, Clock, GraduationCap, MapPin, User } from 'lucide-react';
import { formatMinuteOfDay, periodBoundary } from './timetable-format';
import { colorFor, formatMonthDay, weekdayName } from '../../../modules/todo/view';
import type { CalendarItemDetail } from './WeekCalendar';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '../../../ui/dialog';

export function EventDetailDialog({
  detail: { lesson, date },
  onClose,
}: {
  detail: CalendarItemDetail;
  onClose: () => void;
}) {
  const tone = colorFor(lesson.courseCode || lesson.courseName);
  const start = formatMinuteOfDay(periodBoundary(lesson.startPeriod, 'start'));
  const end = formatMinuteOfDay(periodBoundary(lesson.endPeriod, 'end'));
  const timeText = date
    ? `${formatMonthDay(date)}（${weekdayName(date)}）${start} – ${end}`
    : `${start} – ${end}`;

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-100 max-w-[calc(100vw-2rem)] overflow-y-auto p-5">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-1 size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: `var(--cal-${tone}-bg)` }}
          />
          <DialogTitle className="min-w-0 flex-1 break-words leading-snug tracking-tight">
            {lesson.courseName}
          </DialogTitle>
          <DialogClose />
        </div>
        {lesson.className || lesson.courseCode ? (
          <DialogDescription className="pl-5">
            {[lesson.className, lesson.courseCode].filter(Boolean).join(' · ')}
          </DialogDescription>
        ) : null}
        <div className="mt-4 grid gap-2.5 pl-5 text-sm">
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-ink-3" />
            <span className="tabular-nums">{timeText}</span>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" />
            <span className="break-words">
              {[lesson.classroom, lesson.campus].filter(Boolean).join(' · ') || '地点未定'}
            </span>
          </div>
          {lesson.teacher ? (
            <div className="flex items-start gap-2">
              <User className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span className="break-words">{lesson.teacher}</span>
            </div>
          ) : null}
          <div className="flex items-start gap-2">
            <CalendarRange className="mt-0.5 size-4 shrink-0 text-ink-3" />
            <span>{lesson.weeksText}</span>
          </div>
          {lesson.credits != null ? (
            <div className="flex items-start gap-2">
              <GraduationCap className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span>{lesson.credits} 学分</span>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
