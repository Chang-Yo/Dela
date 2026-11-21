import { MapPin } from 'lucide-react';
import type { TimetableLesson } from '../contract';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/tooltip';
import {
  blockHeights,
  eventStyle,
  layoutDayColumns,
  minuteOfDay,
  minutesToRem,
  periodBoundary,
  timelineEnd,
  timelineStart,
  type DayColumnLayout,
} from './timetable-format';
import {
  addDays,
  colorFor,
  dateKey,
  dayMilliseconds,
  eventColorStyle,
  startOfDay,
  weekDays,
} from '../../../modules/todo/view';
import { cn } from '../../../ui/lib/cn';
import { useNow } from '../../../ui/hooks/use-now';

// 当前时间线与「今天」高亮的刷新间隔：now 仅在渲染时取值，需定期重渲染保持新鲜。
const NOW_REFRESH_INTERVAL_MS = 60_000;

export type CalendarItemDetail = { lesson: TimetableLesson; date: Date | null };

export function WeekCalendar({
  lessons,
  weekStart,
  onOpen,
}: {
  lessons: readonly TimetableLesson[];
  weekStart: Date | null;
  onOpen: (detail: CalendarItemDetail) => void;
}) {
  useNow(NOW_REFRESH_INTERVAL_MS);
  const timelineHeight = `${minutesToRem(timelineEnd - timelineStart)}rem`;
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
      {/* 容器查询而非窗口断点：主导航侧栏会顶掉断点，内容区不足 860px 仍渲染桌面网格会横向滚动。 */}
      <div className="hidden min-w-215 @min-[860px]:block">
        <div className="sticky top-0 z-drawer grid grid-cols-[3.625rem_repeat(7,minmax(6.875rem,1fr))] border-b border-line bg-surface/95 backdrop-blur">
          <div className="sticky left-0 bg-surface" />
          {weekDays.map((day, index) => {
            const date = weekStart ? addDays(weekStart, index) : null;
            const today = date ? dateKey(date) === dateKey(new Date()) : false;
            return (
              <div className="border-l px-2 py-2 text-center" key={day}>
                <span className="text-xs text-ink-3">{day}</span>
                {date ? (
                  <strong
                    className={cn(
                      'mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-sm font-semibold',
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
                  'absolute right-2 text-xs tabular-nums text-ink-3',
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
            const layout = layoutDayColumns(
              dailyLessons.map((lesson) => ({
                id: `lesson-${lesson.id}`,
                start: periodBoundary(lesson.startPeriod, 'start'),
                end: periodBoundary(lesson.endPeriod, 'end'),
              })),
            );
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
                {showNow && currentDayIndex === index ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 border-t-[1.5px] border-danger"
                    style={{ top: `${minutesToRem(minuteOfDay(now) - timelineStart)}rem` }}
                  >
                    <span className="absolute -left-1 -top-1 size-2 rounded-full bg-danger" />
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
          if (!dailyLessons.length) return null;
          return (
            <section className="grid gap-2" key={day}>
              <h2 className="flex items-baseline gap-2 text-sm font-semibold">
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
            </section>
          );
        })}
      </div>
    </div>
  );
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
  const open = () => onOpen({ lesson, date });
  // 阈值用 rem 随字号缩放：2.75rem 起显示第二行、3.75rem 起显示节次行，
  // 2.25rem 的单节课块只留课程名，避免第三行被 overflow-hidden 裁半。
  const height = minutesToRem(end - start);
  const showMeta = height >= blockHeights.twoRows;
  const showPeriods = height >= blockHeights.threeRows;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <article
          className="absolute z-10 cursor-pointer overflow-hidden rounded-card px-2 py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-accent-tint"
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
            left: `calc(${layout.left}% + 0.125rem)`,
            width: `calc(${layout.width}% - 0.25rem)`,
          }}
          tabIndex={0}
        >
          <strong className="block break-words text-xs font-semibold leading-tight">
            {lesson.courseName}
          </strong>
          {showMeta && (
            <span className="mt-0.5 block truncate text-xs leading-none opacity-75">
              {[lesson.teacher, lesson.classroom].filter(Boolean).join(' · ') || '地点未定'}
            </span>
          )}
          {showPeriods && (
            <span className="block truncate text-xs leading-none opacity-75">
              {lesson.periodsText}
            </span>
          )}
        </article>
      </TooltipTrigger>
      <TooltipContent className="grid gap-0.5 px-3 py-2 text-left font-normal">
        <strong className="font-semibold">{lesson.courseName}</strong>
        {lesson.teacher ? <span>教师：{lesson.teacher}</span> : null}
        <span>教室：{lesson.classroom || '地点未定'}</span>
        <span>周次：{lesson.weeksText}</span>
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
  const open = () => onOpen({ lesson, date });
  return (
    <article
      className="grid cursor-pointer grid-cols-[3.375rem_1fr] overflow-hidden rounded-card p-3 outline-none focus-visible:ring-3 focus-visible:ring-accent-tint"
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
