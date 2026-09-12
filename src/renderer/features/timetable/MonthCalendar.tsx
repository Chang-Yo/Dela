import type { CalendarEvent, TimetableLesson } from '../../../shared/api';
import {
  activeInWeek,
  addDays,
  dateKey,
  dayMilliseconds,
  formatTime,
  localEventTone,
  localEventsByDay,
  mondayOf,
  toneFor,
  weekDays,
  weekForDate,
} from './timetable-format';
import { cn } from '../../lib/utils';

export function MonthCalendar({
  events,
  lessons,
  month,
  semesterStart,
  onCreate,
}: {
  events: readonly CalendarEvent[];
  lessons: readonly TimetableLesson[];
  month: Date;
  semesterStart: string | null;
  onCreate: (date: Date) => void;
}) {
  const first = mondayOf(new Date(month.getFullYear(), month.getMonth(), 1));
  const nextMonthWeek = mondayOf(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const dayCount = Math.round(
    (addDays(nextMonthWeek, 7).getTime() - first.getTime()) / dayMilliseconds,
  );
  const days = Array.from({ length: dayCount }, (_, index) => addDays(first, index));
  const groupedEvents = localEventsByDay(events);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {!semesterStart ? (
        <p className="border-b bg-muted/40 px-5 py-2 text-[11px] text-muted-foreground">
          旧缓存没有学期日期，月视图暂只显示手动添加的事件；下次成功同步后会补齐课程。
        </p>
      ) : null}
      <div className="hidden grid-cols-7 border-b text-center text-[11px] font-medium text-muted-foreground md:grid">
        {weekDays.map((day) => (
          <div className="py-2" key={day}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 max-md:grid-cols-1">
        {days.map((date) => {
          const currentMonth = date.getMonth() === month.getMonth();
          const today = dateKey(date) === dateKey(new Date());
          const week = weekForDate(semesterStart, date);
          const dayLessons =
            week && week > 0
              ? lessons.filter(
                  (lesson) => lesson.weekday === (date.getDay() || 7) && activeInWeek(lesson, week),
                )
              : [];
          const dayEvents = groupedEvents.get(dateKey(date)) ?? [];
          const items = [
            ...dayEvents.map((event) => ({
              id: `event-${event.id}`,
              title: event.title,
              time: formatTime(new Date(event.startAt)),
              tone: localEventTone,
            })),
            ...dayLessons.map((lesson) => ({
              id: `lesson-${lesson.id}`,
              title: lesson.courseName,
              time: lesson.periodsText,
              tone: toneFor(lesson.courseCode || lesson.courseName),
            })),
          ];
          return (
            <button
              className={cn(
                'min-h-28 border-b p-2 text-left align-top transition-colors hover:bg-accent/45 max-md:grid max-md:min-h-16 max-md:grid-cols-[44px_1fr] max-md:gap-2',
                !currentMonth && 'bg-muted/25 text-muted-foreground max-md:hidden',
              )}
              key={dateKey(date)}
              onClick={() => onCreate(date)}
            >
              <span
                className={cn(
                  'mb-1 grid size-6 place-items-center rounded-full text-xs font-medium max-md:mb-0',
                  today && 'bg-primary text-primary-foreground',
                )}
              >
                {date.getDate()}
              </span>
              <span className="grid min-w-0 gap-0.5">
                {items.slice(0, 3).map((item) => (
                  <span
                    className={cn(
                      'flex h-5 min-w-0 items-center gap-1 rounded px-1.5 text-[11px]',
                      item.tone,
                    )}
                    key={item.id}
                  >
                    <span className="shrink-0 tabular-nums opacity-70">{item.time}</span>
                    <span className="truncate font-medium">{item.title}</span>
                  </span>
                ))}
                {items.length > 3 ? (
                  <span className="px-1.5 text-[10px] text-muted-foreground">
                    还有 {items.length - 3} 项
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
