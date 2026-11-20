import { useEffect, useState } from 'react';
import type { CalendarEvent, TimetableLesson } from '../contract';
import { activeInWeek, localEventsByDay, weekForDate } from './timetable-format';
import {
  addDays,
  colorFor,
  dateKey,
  dayMilliseconds,
  eventColorStyle,
  eventTone,
  formatMonthDay,
  formatTime,
  mondayOf,
  weekDays,
} from '../../../modules/todo/view';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
import { cn } from '../../../ui/lib/cn';

export function MonthCalendar({
  events,
  lessons,
  month,
  semesterStart,
  onCreate,
  onEditSemesterStart,
}: {
  events: readonly CalendarEvent[];
  lessons: readonly TimetableLesson[];
  month: Date;
  semesterStart: string | null;
  onCreate: (start: Date, end?: Date) => void;
  onEditSemesterStart: () => void;
}) {
  const first = mondayOf(new Date(month.getFullYear(), month.getMonth(), 1));
  const nextMonthWeek = mondayOf(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const dayCount = Math.round(
    (addDays(nextMonthWeek, 7).getTime() - first.getTime()) / dayMilliseconds,
  );
  const days = Array.from({ length: dayCount }, (_, index) => addDays(first, index));
  const groupedEvents = localEventsByDay(events);
  const [drag, setDrag] = useState<{ start: Date; end: Date } | null>(null);
  const dragRange = drag
    ? [
        drag.start.getTime() <= drag.end.getTime() ? drag.start : drag.end,
        drag.start.getTime() <= drag.end.getTime() ? drag.end : drag.start,
      ]
    : null;

  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      const [start, end] =
        drag.start.getTime() <= drag.end.getTime()
          ? [drag.start, drag.end]
          : [drag.end, drag.start];
      setDrag(null);
      onCreate(start, end);
    };
    window.addEventListener('mouseup', finish);
    return () => window.removeEventListener('mouseup', finish);
  }, [drag, onCreate]);

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
          const dayEvents = groupedEvents.get(dateKey(date)) ?? [];
          const items = [
            ...dayEvents.map((event) => ({
              id: `event-${event.id}`,
              title: event.title,
              time:
                dateKey(new Date(event.startAt)) === dateKey(date)
                  ? // 待办块止于截止时刻，pill 上显示的是截止时间而非合成的开始时间。
                    formatTime(new Date(event.todoId ? event.endAt : event.startAt))
                  : null,
              tone: eventTone(event.color),
            })),
            ...dayLessons.map((lesson) => ({
              id: `lesson-${lesson.id}`,
              title: lesson.courseName,
              time: lesson.periodsText,
              tone: eventColorStyle(colorFor(lesson.courseCode || lesson.courseName)),
            })),
          ];
          // 拖拽可以跨到补位的相邻日期创建，但只有当月日期参与高亮。
          const selected =
            !!dragRange && currentMonth && date >= dragRange[0]! && date <= dragRange[1]!;
          return (
            <div
              aria-current={today ? 'date' : undefined}
              aria-label={`${date.getMonth() + 1}月${date.getDate()}日`}
              className={cn(
                // 用 div + role 是为了能嵌套「更多」按钮，button 里不能再放交互元素。
                'flex min-h-28 flex-col border-b border-line p-2 text-left transition-colors duration-base hover:bg-hover @max-[320px]:min-h-16 @max-[320px]:p-1',
                selected && 'bg-accent-tint',
                !currentMonth && 'bg-inset text-ink-3',
              )}
              key={dateKey(date)}
              role="button"
              tabIndex={0}
              onClick={(event) => {
                // 读屏等合成的 click detail 为 0，同样只认日格自身，忽略「更多」冒泡。
                if (event.detail === 0 && event.target === event.currentTarget) onCreate(date);
              }}
              onKeyDown={(event) => {
                // 只响应日格自身的键盘激活，忽略内部「更多」按钮冒泡上来的按键。
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onCreate(date);
                }
              }}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                setDrag({ start: date, end: date });
              }}
              onMouseEnter={() => {
                if (drag) setDrag((current) => current && { ...current, end: date });
              }}
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
                    <PopoverTrigger
                      className="flex h-5 items-center rounded-chip px-1.5 text-left text-xs text-ink-3 outline-none transition-colors duration-fast hover:bg-hover-strong hover:text-ink focus-visible:ring-3 focus-visible:ring-accent-tint"
                      // 不让「更多」上的按下冒泡成日格拖拽的起点。
                      onMouseDown={(event) => event.stopPropagation()}
                    >
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
