import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { CalendarEvent, TimetableLesson } from '../../../shared/api';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import {
  addDays,
  blockHeights,
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
  minutesToRem,
  periodBoundary,
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
  const timelineHeight = `${minutesToRem(timelineEnd - timelineStart)}rem`;
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
  const hours = Array.from(
    { length: timelineEnd / 60 - timelineStart / 60 + 1 },
    (_, index) => timelineStart / 60 + index,
  );

  return (
    <div className="@container min-h-0 flex-1 overflow-auto">
      {/* 容器查询按内容区实际宽度切换桌面网格/按日堆叠：窗口断点会被主导航侧栏（200–360px）顶掉，
          窗口 768–1050px 时内容区不足 860px 仍渲染桌面网格，必然出现横向滚动。 */}
      <div className="hidden min-w-[53.75rem] @min-[860px]:block">
        <div className="sticky top-0 z-30 grid grid-cols-[3.625rem_repeat(7,minmax(6.875rem,1fr))] border-b border-line bg-surface/95 backdrop-blur">
          {/* 防御：滚动条占宽等边缘情况引发横向滚动时，时刻度列常驻左缘。 */}
          <div className="sticky left-0 bg-surface" />
          {weekDays.map((day, index) => {
            const date = weekStart ? addDays(weekStart, index) : null;
            const today = date ? dateKey(date) === dateKey(new Date()) : false;
            return (
              <div className="border-l px-2 py-2 text-center" key={day}>
                <span className="text-2xs text-ink-3">{day}</span>
                {date ? (
                  <strong
                    className={cn(
                      'mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-13 font-semibold',
                      today && 'bg-ink text-surface',
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
          className="relative grid grid-cols-[3.625rem_repeat(7,minmax(6.875rem,1fr))]"
          style={{ height: timelineHeight }}
        >
          <div className="sticky left-0 z-20 bg-surface">
            {hours.map((hour) => (
              <span
                className={cn(
                  'absolute right-2 text-2xs tabular-nums text-ink-3',
                  // 首个刻度在网格顶边，上移一半会被表头遮住。
                  hour * 60 > timelineStart && '-translate-y-1/2',
                )}
                key={hour}
                style={{ top: `${minutesToRem(hour * 60 - timelineStart)}rem` }}
              >
                {hour}:00
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-[3.625rem] right-0">
            {hours.map((hour) => (
              <div
                className="absolute inset-x-0 border-t"
                key={hour}
                style={{ top: `${minutesToRem(hour * 60 - timelineStart)}rem` }}
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
                    style={{ top: `${minutesToRem(minuteOfDay(now) - timelineStart)}rem` }}
                  >
                    <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="hidden gap-5 p-3 @max-[860px]:grid">
        {weekDays.map((day, index) => {
          const date = weekStart ? addDays(weekStart, index) : null;
          const dailyLessons = lessons.filter((lesson) => lesson.weekday === index + 1);
          const dailyEvents = date ? (groupedEvents.get(dateKey(date)) ?? []) : [];
          if (!dailyLessons.length && !dailyEvents.length) return null;
          return (
            <section className="grid gap-2" key={day}>
              <h2 className="flex items-baseline gap-2 text-13 font-semibold">
                <span>{day}</span>
                {date ? (
                  <span className="text-xs font-normal text-ink-3">
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
  // 与 LocalEventBlock 同一阈值（rem，随字号缩放）：2.75rem 起显示第二行、3.75rem 起显示节次行，
  // 2.25rem 的单节课块只留课程名，避免第三行被 overflow-hidden 裁半。
  const height = minutesToRem(end - start);
  const showMeta = height >= blockHeights.twoRows;
  const showPeriods = height >= blockHeights.threeRows;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <article
          className="absolute z-10 cursor-pointer overflow-hidden rounded-card px-2 py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-bui-accent-tint"
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
            // 两侧各留 0.125rem 与相邻并排列隔开，单项独占时等价于原来的 inset-x-1。
            left: `calc(${layout.left}% + 0.125rem)`,
            width: `calc(${layout.width}% - 0.25rem)`,
          }}
          tabIndex={0}
        >
          <strong className="block break-words text-xs font-semibold leading-tight">
            {lesson.courseName}
          </strong>
          {/* 教师排在教室之前：并排窄列截断时保证教师可见。矮块隐藏次要行，完整信息看 Tooltip。 */}
          {showMeta && (
            <span className="mt-0.5 block truncate text-2xs leading-none opacity-75">
              {[lesson.teacher, lesson.classroom].filter(Boolean).join(' · ') || '地点未定'}
            </span>
          )}
          {showPeriods && (
            <span className="block truncate text-2xs leading-none opacity-75">
              {lesson.periodsText}
            </span>
          )}
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
  const left = bleedLeft ? -1 : `calc(${layout.left}% + 0.125rem)`;
  const width =
    bleedLeft && bleedRight
      ? 'calc(100% + 1px)'
      : bleedLeft
        ? 'calc(100% - 1px)'
        : bleedRight
          ? 'calc(100% - 2px)'
          : `calc(${layout.width}% - 0.25rem)`;
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const span = eventSpan(event);
  // 内容区按中文行高实测需 2.5rem（标题 0.9375 + 间距 0.125 + 时间行 0.6875 + 内边距 0.75）
  // 展示标题与时间，2.75rem（55 分钟）起显示时间行、3.75rem（75 分钟）起显示地点行，
  // 避免矮块文字贴底被裁切。
  const height = minutesToRem(span.end - span.start);
  // 时间前缀只在首段显示；跨天事件首段写全起止日期，避免“22:00–10:00”式误导。
  const showTime = edges.isStart && height >= blockHeights.twoRows;
  const showLocation = showTime && Boolean(event.location) && height >= blockHeights.threeRows;
  const open = () => onOpen(event.todoId ? { kind: 'todo', event } : { kind: 'event', event });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <article
          className={cn(
            'absolute z-10 cursor-pointer overflow-hidden px-2 py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-bui-accent-tint',
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
            <span className="mt-0.5 block truncate text-2xs leading-none opacity-70">
              {edges.isEnd
                ? `${formatTime(start)}–${formatTime(end)}`
                : `${formatMonthDay(start)} ${formatTime(start)} – ${formatMonthDay(end)} ${formatTime(end)}`}
            </span>
          ) : null}
          {showLocation ? (
            <span className="block truncate text-2xs leading-none opacity-70">
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
      className="grid cursor-pointer grid-cols-[3.375rem_1fr] overflow-hidden rounded-card p-3 outline-none focus-visible:ring-[3px] focus-visible:ring-bui-accent-tint"
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
      className="grid cursor-pointer grid-cols-[3.375rem_1fr] rounded-card p-3 outline-none focus-visible:ring-[3px] focus-visible:ring-bui-accent-tint"
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
