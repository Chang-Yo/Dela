import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { CalendarEvent, TimetableLesson } from '../../../shared/api';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import {
  addDays,
  colorFor,
  dateKey,
  dayMilliseconds,
  eventColorStyle,
  eventDayEdges,
  eventStyle,
  eventTone,
  formatEventRange,
  formatMonthDay,
  formatTime,
  layoutDayColumns,
  localEventsByDay,
  minuteOfDay,
  periodBoundary,
  pixelsPerMinute,
  startOfDay,
  timelineEnd,
  timelineStart,
  weekDays,
  type DayColumnLayout,
} from './timetable-format';
import { cn } from '../../lib/utils';

// 当前时间线与「今天」高亮的刷新间隔：now 仅在渲染时取值，需定期重渲染保持新鲜。
const NOW_REFRESH_INTERVAL_MS = 60_000;

// 点击周视图条目后弹详情的数据形态（课程只读，自建事件可删除，待办派生事件跳转 TODO）。
export type CalendarItemDetail =
  | { kind: 'lesson'; lesson: TimetableLesson; date: Date | null }
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'todo'; event: CalendarEvent };

export function WeekCalendar({
  lessons,
  events,
  weekStart,
  onOpen,
}: {
  lessons: readonly TimetableLesson[];
  events: readonly CalendarEvent[];
  weekStart: Date | null;
  onOpen: (detail: CalendarItemDetail) => void;
}) {
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNowTick((tick) => tick + 1), NOW_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
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
          {/* 横向滚动（内容窄于 860px）时刻度列常驻左缘。 */}
          <div className="sticky left-0 bg-background" />
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
          <div className="sticky left-0 z-20 bg-background">
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
            // 课程与本地事件共享同一条日列，必须参与同一次并排布局，否则时间重叠时互相覆盖。
            const layout = layoutDayColumns([
              ...dailyLessons.map((lesson) => ({
                id: `lesson-${lesson.id}`,
                start: periodBoundary(lesson.startPeriod, 'start'),
                end: periodBoundary(lesson.endPeriod, 'end'),
              })),
              ...dailyEvents.map((event) => ({ id: `event-${event.id}`, ...eventSpan(event) })),
            ]);
            return (
              <div className="relative border-l" key={day}>
                {dailyLessons.map((lesson) => (
                  <LessonBlock
                    date={date}
                    key={lesson.id}
                    layout={layout.get(`lesson-${lesson.id}`)!}
                    lesson={lesson}
                    onOpen={onOpen}
                  />
                ))}
                {dailyEvents.map((event) => (
                  <LocalEventBlock
                    date={date}
                    dayIndex={index}
                    event={event}
                    key={event.id}
                    layout={layout.get(`event-${event.id}`)!}
                    onOpen={onOpen}
                  />
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
                  <MobileLesson date={date} key={lesson.id} lesson={lesson} onOpen={onOpen} />
                ))}
              {dailyEvents.map((event) => (
                <MobileEvent event={event} key={event.id} onOpen={onOpen} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// 事件参与布局与渲染的是同一区间：裁剪到时间轴范围内。
function eventSpan(event: CalendarEvent): { start: number; end: number } {
  return {
    start: Math.max(timelineStart, minuteOfDay(new Date(event.startAt))),
    end: Math.min(timelineEnd, minuteOfDay(new Date(event.endAt))),
  };
}

function LessonBlock({
  date,
  layout,
  lesson,
  onOpen,
}: {
  date: Date | null;
  layout: DayColumnLayout;
  lesson: TimetableLesson;
  onOpen: (detail: CalendarItemDetail) => void;
}) {
  const start = periodBoundary(lesson.startPeriod, 'start');
  const end = periodBoundary(lesson.endPeriod, 'end');
  const open = () => onOpen({ kind: 'lesson', lesson, date });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <article
          className="absolute z-10 cursor-pointer overflow-hidden rounded-lg px-2 py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              open();
            }
          }}
          role="button"
          style={{
            ...eventColorStyle(colorFor(lesson.courseCode || lesson.courseName)),
            ...eventStyle(start, end),
            // 两侧各留 2px 与相邻并排列隔开，单项独占时等价于原来的 inset-x-1。
            left: `calc(${layout.left}% + 2px)`,
            width: `calc(${layout.width}% - 4px)`,
          }}
          tabIndex={0}
        >
          <strong className="block break-words text-xs font-semibold leading-tight">
            {lesson.courseName}
          </strong>
          {/* 教师排在教室之前：并排窄列截断时保证教师可见。 */}
          <span className="mt-0.5 block truncate text-[11px] leading-none opacity-75">
            {[lesson.teacher, lesson.classroom].filter(Boolean).join(' · ') || '地点未定'}
          </span>
          <span className="block truncate text-[11px] leading-none opacity-75">
            {lesson.periodsText}
          </span>
        </article>
      </TooltipTrigger>
      {/* 原生 title 不支持富文本与可靠换行，改用共享的 Radix Tooltip 展示完整信息。 */}
      <TooltipContent className="grid gap-0.5 px-3 py-2 text-left font-normal">
        <strong className="font-semibold">{lesson.courseName}</strong>
        {lesson.teacher ? <span>教师：{lesson.teacher}</span> : null}
        <span>教室：{lesson.classroom || '地点未定'}</span>
        <span>周次：{lesson.weeksText}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function LocalEventBlock({
  date,
  dayIndex,
  event,
  layout,
  onOpen,
}: {
  date: Date | null;
  dayIndex: number;
  event: CalendarEvent;
  layout: DayColumnLayout;
  onOpen: (detail: CalendarItemDetail) => void;
}) {
  const edges = date ? eventDayEdges(event, date) : { isStart: true, isEnd: true };
  // 参照 Google Calendar / FullCalendar 的连续条：事件真实首末日有圆角收口，
  // 中间日两侧直边；跨过周首/周末时没有相邻的可见列，按周边缘正常收口。
  const leftCap = edges.isStart || dayIndex === 0;
  const rightCap = edges.isEnd || dayIndex === weekDays.length - 1;
  // 仅独占整列时向相邻列出血连成一条；与课程并排时无法出血，退回独立胶囊。
  const bleedLeft = !leftCap && layout.width === 100;
  const bleedRight = !rightCap && layout.width === 100;
  // 出血侧越过日列间 1px 分隔线，相邻两段才能无缝相接。
  const left = bleedLeft ? -1 : `calc(${layout.left}% + 2px)`;
  const width =
    bleedLeft && bleedRight
      ? 'calc(100% + 1px)'
      : bleedLeft
        ? 'calc(100% - 1px)'
        : bleedRight
          ? 'calc(100% - 2px)'
          : `calc(${layout.width}% - 4px)`;
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const span = eventSpan(event);
  // 内容区按中文行高实测约需 12+15+2+11=40px 展示标题与时间，44px（55 分钟）起显示
  // 时间行、60px（75 分钟）起显示地点行，避免矮块文字贴底被裁切。
  const height = (span.end - span.start) * pixelsPerMinute;
  // 时间前缀只在首段显示；跨天事件首段写全起止日期，避免“22:00–10:00”式误导。
  const showTime = edges.isStart && height >= 44;
  const showLocation = showTime && Boolean(event.location) && height >= 60;
  const open = () => onOpen(event.todoId ? { kind: 'todo', event } : { kind: 'event', event });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <article
          className={cn(
            'absolute z-10 cursor-pointer overflow-hidden px-2 py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            bleedLeft ? 'rounded-l-none' : 'rounded-l-lg',
            bleedRight ? 'rounded-r-none' : 'rounded-r-lg',
          )}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              open();
            }
          }}
          role="button"
          style={{
            ...eventTone(event.color),
            ...eventStyle(span.start, span.end),
            left,
            width,
          }}
          tabIndex={0}
        >
          <strong className="block break-words text-xs font-semibold leading-tight">
            {event.title}
          </strong>
          {showTime ? (
            <span className="mt-0.5 block truncate text-[11px] leading-none opacity-70">
              {edges.isEnd
                ? `${formatTime(start)}–${formatTime(end)}`
                : `${formatMonthDay(start)} ${formatTime(start)} – ${formatMonthDay(end)} ${formatTime(end)}`}
            </span>
          ) : null}
          {showLocation ? (
            <span className="block truncate text-[11px] leading-none opacity-70">
              {event.location}
            </span>
          ) : null}
        </article>
      </TooltipTrigger>
      <TooltipContent className="grid gap-0.5 px-3 py-2 text-left font-normal">
        <strong className="font-semibold">{event.title}</strong>
        <span>{formatEventRange(event)}</span>
        {event.location ? <span>地点：{event.location}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function MobileLesson({
  date,
  lesson,
  onOpen,
}: {
  date: Date | null;
  lesson: TimetableLesson;
  onOpen: (detail: CalendarItemDetail) => void;
}) {
  const start = periodBoundary(lesson.startPeriod, 'start');
  const open = () => onOpen({ kind: 'lesson', lesson, date });
  return (
    <article
      className="grid cursor-pointer grid-cols-[54px_1fr] overflow-hidden rounded-lg p-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      role="button"
      style={eventColorStyle(colorFor(lesson.courseCode || lesson.courseName))}
      tabIndex={0}
    >
      <div className="border-r pr-3 text-xs tabular-nums opacity-75">
        <strong className="block font-semibold text-inherit">
          {`${Math.floor(start / 60)}`.padStart(2, '0')}:{`${start % 60}`.padStart(2, '0')}
        </strong>
        {lesson.startPeriod}–{lesson.endPeriod}节
      </div>
      <div className="min-w-0 pl-3">
        <strong className="block break-words">{lesson.courseName}</strong>
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

function MobileEvent({
  event,
  onOpen,
}: {
  event: CalendarEvent;
  onOpen: (detail: CalendarItemDetail) => void;
}) {
  const start = new Date(event.startAt);
  const open = () => onOpen(event.todoId ? { kind: 'todo', event } : { kind: 'event', event });
  return (
    <article
      className="grid cursor-pointer grid-cols-[54px_1fr] rounded-lg p-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      role="button"
      style={eventTone(event.color)}
      tabIndex={0}
    >
      <div className="border-r pr-3 text-xs font-medium tabular-nums">{formatTime(start)}</div>
      <div className="min-w-0 pl-3">
        <strong className="block break-words">{event.title}</strong>
        {event.location ? (
          <span className="mt-1 block truncate text-xs opacity-70">{event.location}</span>
        ) : null}
      </div>
    </article>
  );
}
