import type { TimetableLesson } from '../contract';
import { activeInWeek, weekForDate } from './timetable-format';
import {
  addDays,
  colorFor,
  dateKey,
  dayMilliseconds,
  eventColorStyle,
  formatMonthDay,
  mondayOf,
  weekDays,
} from '../../../modules/todo/view';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
import { cn } from '../../../ui/lib/cn';

export function MonthCalendar({
  lessons,
  month,
  semesterStart,
  onEditSemesterStart,
}: {
  lessons: readonly TimetableLesson[];
  month: Date;
  semesterStart: string | null;
  onEditSemesterStart: () => void;
}) {
  const first = mondayOf(new Date(month.getFullYear(), month.getMonth(), 1));
  const nextMonthWeek = mondayOf(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const dayCount = Math.round(
    (addDays(nextMonthWeek, 7).getTime() - first.getTime()) / dayMilliseconds,
  );
  const days = Array.from({ length: dayCount }, (_, index) => addDays(first, index));

  return (
    <div className="@container min-h-0 flex-1 overflow-auto">
      {!semesterStart ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-inset px-5 py-2 text-xs text-ink-3 max-md:px-3">
          <span>还没有开学日期，课程暂不显示在月历上。</span>
          <button
            className="font-medium text-ink underline-offset-2 hover:underline"
            onClick={onEditSemesterStart}
            type="button"
          >
            设置开学日期
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-7 border-b">
        {weekDays.map((day) => (
          <div className="px-2 py-2 text-center text-xs text-ink-3 @max-[320px]:px-1" key={day}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid select-none grid-cols-7">
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
          const items = dayLessons.map((lesson) => ({
            id: `lesson-${lesson.id}`,
            title: lesson.courseName,
            time: lesson.periodsText,
            tone: eventColorStyle(colorFor(lesson.courseCode || lesson.courseName)),
          }));
          return (
            <div
              aria-current={today ? 'date' : undefined}
              aria-label={`${date.getMonth() + 1}月${date.getDate()}日`}
              className={cn(
                'flex min-h-28 flex-col border-b border-line p-2 text-left @max-[320px]:min-h-16 @max-[320px]:p-1',
                !currentMonth && 'bg-inset text-ink-3',
              )}
              key={dateKey(date)}
            >
              <span
                className={cn(
                  'mb-1 grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium',
                  today && 'bg-ink text-surface',
                )}
              >
                {date.getDate()}
              </span>
              <span className="grid min-w-0 gap-0.5">
                {items.slice(0, 3).map((item) => (
                  <span
                    className="@container flex h-5 min-w-0 items-center gap-1 rounded px-1.5 text-xs @max-[320px]:h-2 @max-[320px]:w-2 @max-[320px]:rounded-full @max-[320px]:overflow-hidden @max-[320px]:p-0"
                    key={item.id}
                    style={item.tone}
                  >
                    {item.time ? (
                      <span className="hidden shrink-0 tabular-nums opacity-70 @min-[120px]:inline">
                        {item.time}
                      </span>
                    ) : null}
                    <span className="truncate font-medium" title={item.title}>
                      {item.title}
                    </span>
                  </span>
                ))}
                {items.length > 3 ? (
                  <Popover>
                    <PopoverTrigger className="flex h-5 items-center rounded-chip px-1.5 text-left text-xs text-ink-3 outline-none transition-colors duration-fast hover:bg-hover-strong hover:text-ink focus-visible:ring-3 focus-visible:ring-accent-tint">
                      +{items.length - 3}
                      <span className="@max-[320px]:hidden"> 更多</span>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56" sideOffset={4}>
                      <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-3">
                        {formatMonthDay(date)}
                      </p>
                      <ul className="grid gap-0.5 p-1">
                        {items.map((item) => (
                          <li
                            className="flex h-6 min-w-0 items-center gap-1.5 rounded px-1.5 text-xs"
                            key={item.id}
                            style={item.tone}
                          >
                            {item.time ? (
                              <span className="shrink-0 tabular-nums opacity-70">{item.time}</span>
                            ) : null}
                            <span className="truncate font-medium" title={item.title}>
                              {item.title}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
