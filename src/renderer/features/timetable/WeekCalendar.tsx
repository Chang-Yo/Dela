import { MapPin } from 'lucide-react';
import type { CalendarEvent, TimetableLesson } from '../../../shared/api';
import {
  addDays,
  dateKey,
  dayMilliseconds,
  eventStyle,
  formatTime,
  localEventTone,
  localEventsByDay,
  minuteOfDay,
  periodBoundary,
  pixelsPerMinute,
  startOfDay,
  timelineEnd,
  timelineStart,
  toneFor,
  weekDays,
} from './timetable-format';
import { cn } from '../../lib/utils';

export function WeekCalendar({
  lessons,
  events,
  weekStart,
}: {
  lessons: readonly TimetableLesson[];
  events: readonly CalendarEvent[];
  weekStart: Date | null;
}) {
  const timelineHeight = (timelineEnd - timelineStart) * pixelsPerMinute;
  const groupedEvents = localEventsByDay(events);
  const now = new Date();
  const currentDayIndex = weekStart
    ? Math.floor((startOfDay(now).getTime() - weekStart.getTime()) / dayMilliseconds)
    : -1;
  const showNow =
    currentDayIndex >= 0 &&
    currentDayIndex < 7 &&
    minuteOfDay(now) >= timelineStart &&
    minuteOfDay(now) <= timelineEnd;
  const hours = Array.from({ length: 13 }, (_, index) => 8 + index);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="hidden min-w-[860px] md:block">
        <div className="sticky top-0 z-30 grid grid-cols-[58px_repeat(7,minmax(110px,1fr))] border-b bg-background/95 backdrop-blur">
          <div />
          {weekDays.map((day, index) => {
            const date = weekStart ? addDays(weekStart, index) : null;
            const today = date ? dateKey(date) === dateKey(new Date()) : false;
            return (
              <div className="border-l px-2 py-2 text-center" key={day}>
                <span className="text-[11px] text-muted-foreground">{day}</span>
                {date ? (
                  <strong
                    className={cn(
                      'mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-sm font-semibold',
                      today && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {date.getDate()}
                  </strong>
                ) : null}
              </div>
            );
          })}
        </div>
        <div
          className="relative grid grid-cols-[58px_repeat(7,minmax(110px,1fr))]"
          style={{ height: timelineHeight }}
        >
          <div className="relative">
            {hours.map((hour) => (
              <span
                className={cn(
                  'absolute right-2 text-[11px] tabular-nums text-muted-foreground',
                  // 首个刻度在网格顶边，上移一半会被表头遮住。
                  hour * 60 > timelineStart && '-translate-y-1/2',
                )}
                key={hour}
                style={{ top: (hour * 60 - timelineStart) * pixelsPerMinute }}
              >
                {hour}:00
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-[58px] right-0">
            {hours.map((hour) => (
              <div
                className="absolute inset-x-0 border-t"
                key={hour}
                style={{ top: (hour * 60 - timelineStart) * pixelsPerMinute }}
              />
            ))}
          </div>
          {weekDays.map((day, index) => {
            const date = weekStart ? addDays(weekStart, index) : null;
            const dailyLessons = lessons.filter((lesson) => lesson.weekday === index + 1);
            const dailyEvents = date ? (groupedEvents.get(dateKey(date)) ?? []) : [];
            return (
              <div className="relative border-l" key={day}>
                {dailyLessons.map((lesson) => (
                  <LessonBlock key={lesson.id} lesson={lesson} />
                ))}
                {dailyEvents.map((event) => (
                  <LocalEventBlock event={event} key={event.id} />
                ))}
                {showNow && currentDayIndex === index ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 border-t-[1.5px] border-red-500"
                    style={{ top: (minuteOfDay(now) - timelineStart) * pixelsPerMinute }}
                  >
                    <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid gap-5 p-3 md:hidden">
        {weekDays.map((day, index) => {
          const date = weekStart ? addDays(weekStart, index) : null;
          const dailyLessons = lessons.filter((lesson) => lesson.weekday === index + 1);
          const dailyEvents = date ? (groupedEvents.get(dateKey(date)) ?? []) : [];
          if (!dailyLessons.length && !dailyEvents.length) return null;
          return (
            <section className="grid gap-2" key={day}>
              <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                <span>{day}</span>
                {date ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {date.getMonth() + 1}月{date.getDate()}日
                  </span>
                ) : null}
              </h2>
              {[...dailyLessons]
                .sort((a, b) => a.startPeriod - b.startPeriod)
                .map((lesson) => (
                  <MobileLesson lesson={lesson} key={lesson.id} />
                ))}
              {dailyEvents.map((event) => (
                <MobileEvent event={event} key={event.id} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LessonBlock({ lesson }: { lesson: TimetableLesson }) {
  const start = periodBoundary(lesson.startPeriod, 'start');
  const end = periodBoundary(lesson.endPeriod, 'end');
  return (
    <article
      className={cn(
        'absolute inset-x-1 z-10 overflow-hidden rounded-lg px-2 py-1.5',
        toneFor(lesson.courseCode || lesson.courseName),
      )}
      style={eventStyle(start, end)}
      title={`${lesson.courseName}\n${lesson.teacher ?? ''}\n${lesson.classroom ?? ''}\n${lesson.weeksText}`}
    >
      <strong className="block truncate text-xs font-semibold leading-tight">
        {lesson.courseName}
      </strong>
      <span className="mt-1 block truncate text-[11px] opacity-75">
        {lesson.classroom || '地点未定'}
      </span>
      <span className="block truncate text-[11px] opacity-75">{lesson.periodsText}</span>
    </article>
  );
}

function LocalEventBlock({ event }: { event: CalendarEvent }) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  return (
    <article
      className={cn(
        'absolute inset-x-1 z-10 overflow-hidden rounded-lg px-2 py-1.5',
        localEventTone,
      )}
      style={eventStyle(
        Math.max(timelineStart, minuteOfDay(start)),
        Math.min(timelineEnd, minuteOfDay(end)),
      )}
    >
      <strong className="block truncate text-xs font-semibold leading-tight">{event.title}</strong>
      <span className="mt-1 block truncate text-[11px] opacity-70">
        {formatTime(start)}–{formatTime(end)}
      </span>
      {event.location ? (
        <span className="block truncate text-[11px] opacity-70">{event.location}</span>
      ) : null}
    </article>
  );
}

function MobileLesson({ lesson }: { lesson: TimetableLesson }) {
  const start = periodBoundary(lesson.startPeriod, 'start');
  return (
    <article
      className={cn(
        'grid grid-cols-[54px_1fr] overflow-hidden rounded-lg p-3',
        toneFor(lesson.courseCode || lesson.courseName),
      )}
    >
      <div className="border-r pr-3 text-xs tabular-nums opacity-75">
        <strong className="block font-semibold text-inherit">
          {`${Math.floor(start / 60)}`.padStart(2, '0')}:{`${start % 60}`.padStart(2, '0')}
        </strong>
        {lesson.startPeriod}–{lesson.endPeriod}节
      </div>
      <div className="min-w-0 pl-3">
        <strong className="block truncate">{lesson.courseName}</strong>
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs opacity-75">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" />
            {lesson.classroom || '地点未定'}
          </span>
          {lesson.teacher ? <span>{lesson.teacher}</span> : null}
        </p>
      </div>
    </article>
  );
}

function MobileEvent({ event }: { event: CalendarEvent }) {
  const start = new Date(event.startAt);
  return (
    <article className={cn('grid grid-cols-[54px_1fr] rounded-lg p-3', localEventTone)}>
      <div className="border-r pr-3 text-xs font-medium tabular-nums">{formatTime(start)}</div>
      <div className="min-w-0 pl-3">
        <strong className="block truncate">{event.title}</strong>
        {event.location ? (
          <span className="mt-1 block truncate text-xs opacity-70">{event.location}</span>
        ) : null}
      </div>
    </article>
  );
}
