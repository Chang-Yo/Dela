import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import type { Navigate } from '../../../app/module';
import { errorMessage } from '../../../core/protocol/contract';
import type { CalendarEvent } from '../contract';
import { Button } from '../../../ui/button';
import { SegmentedControl } from '../../../ui/segmented-control';
import { DesktopOnlyNotice } from '../../../ui/desktop-only-notice';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select';
import { MonthCalendar } from './MonthCalendar';
import { NewEventDialog } from './NewEventDialog';
import { SemesterStartDialog } from './SemesterStartDialog';
import { TimetableConnectCard } from './TimetableConnectCard';
import { connectAndSyncTimetable, timetableClient, useTimetableState } from './use-timetable';
import { WeekCalendar, type CalendarItemDetail } from './WeekCalendar';
import { EventDetailDialog } from './EventDetailDialog';
import {
  activeInWeek,
  formatSyncTime,
  parseDate,
  semesterLabel,
  semesterOptions,
  weekForDate,
  weekStartFor,
} from './timetable-format';
import {
  addDays,
  formatMonthDay,
  mondayOf,
  startOfDay,
  useTodoState,
} from '../../../modules/todo/view';
import { cn } from '../../../ui/lib/cn';
import { showToast } from '../../../ui/toast';
import { Callout } from '../../../ui/alert';

type CalendarMode = 'week' | 'month';

export function TimetableView({ navigate }: { navigate: Navigate }) {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="教学信息服务网的登录会话和本地课表缓存不会暴露给浏览器。"
        title="课表仅在 Dela 桌面端可用"
      />
    );
  }
  return <DesktopTimetableView navigate={navigate} />;
}

function DesktopTimetableView({ navigate }: { navigate: Navigate }) {
  const queryClient = useQueryClient();
  const [requestedSemester, setRequestedSemester] = useState<string>();
  const stateQuery = useTimetableState(requestedSemester);
  const lessonsQuery = useQuery({
    queryKey: requestedSemester
      ? ['timetable', 'lessons', requestedSemester]
      : ['timetable', 'lessons'],
    queryFn: () => timetableClient.lessons(requestedSemester),
    placeholderData: keepPreviousData,
  });
  const state = stateQuery.data;
  const lessons = lessonsQuery.data ?? [];
  const todoItems = useTodoState().data?.items ?? [];
  // 选中的教学周只在本学期有效：换学期后回到本周，同步或改开学日期不会把用户拉回本周。
  const [weekChoice, setWeekChoice] = useState<{ semester: string; week: number } | null>(null);
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [mode, setMode] = useState<CalendarMode>('week');
  const [busy, setBusy] = useState(false);
  const [eventDraft, setEventDraft] = useState<{ start: Date; end: Date } | null>(null);
  const [semesterDraft, setSemesterDraft] = useState(false);
  const [detail, setDetail] = useState<CalendarItemDetail | null>(null);

  const currentWeek = weekForDate(state?.semesterStart ?? null, new Date());
  const selectedWeek =
    weekChoice && weekChoice.semester === state?.semester
      ? weekChoice.week
      : currentWeek && currentWeek > 0
        ? currentWeek
        : 1;
  const selectWeek = (week: number) => {
    if (state) setWeekChoice({ semester: state.semester, week });
  };

  const semesterWeekStart = weekStartFor(state?.semesterStart ?? null, selectedWeek);
  const visibleWeekStart = semesterWeekStart ?? mondayOf(new Date());
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthGridStart = mondayOf(monthStart);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const monthGridEnd = addDays(mondayOf(nextMonth), 7);
  const eventRangeStart = mode === 'week' ? visibleWeekStart : monthGridStart;
  const eventRangeEnd = mode === 'week' ? addDays(visibleWeekStart, 7) : monthGridEnd;

  const eventsQuery = useQuery({
    queryKey: ['timetable', 'events', eventRangeStart.toISOString(), eventRangeEnd.toISOString()],
    queryFn: () =>
      timetableClient.events({
        startAt: eventRangeStart.toISOString(),
        endAt: eventRangeEnd.toISOString(),
      }),
    placeholderData: keepPreviousData,
  });

  // 写入日历的个人待办派生为 30 分钟事件块、止于截止时刻；id 走 `todo:` 前缀命名空间。
  const todoEvents = todoItems.flatMap((todo) => {
    if (todo.source !== 'personal' || !todo.calendar || !todo.dueAt) return [];
    const dueAt = Date.parse(todo.dueAt);
    if (dueAt < eventRangeStart.getTime() || dueAt > eventRangeEnd.getTime()) return [];
    return [
      {
        id: `todo:${todo.id}`,
        todoId: todo.id,
        title: todo.title,
        startAt: new Date(dueAt - 30 * 60_000).toISOString(),
        endAt: todo.dueAt,
        location: null,
        color: todo.color ?? null,
      } satisfies CalendarEvent,
    ];
  });
  const calendarEvents = [...(eventsQuery.data ?? []), ...todoEvents];

  const foundWeeks = [...new Set(lessons.flatMap((lesson) => lesson.weekNumbers))].sort(
    (a, b) => a - b,
  );
  const weeks = foundWeeks.length
    ? foundWeeks
    : Array.from({ length: 18 }, (_, index) => index + 1);
  const weekLessons = lessons.filter((lesson) => activeInWeek(lesson, selectedWeek));
  const loadError = stateQuery.error ?? lessonsQuery.error ?? eventsQuery.error;

  const reload = () => queryClient.invalidateQueries({ queryKey: ['timetable'] });

  const connectAndSync = async () => {
    setBusy(true);
    const connect = async () => {
      const failure = await connectAndSyncTimetable(state?.semester);
      if (failure) {
        showToast({ variant: 'error', title: '登录同步失败', description: failure });
        return;
      }
      await reload();
    };
    await connect().finally(() => setBusy(false));
  };

  const sync = async () => {
    setBusy(true);
    const syncTimetable = async () => {
      const result = await timetableClient.sync(state?.semester);
      if (!result.ok) {
        // 会话过期是唯一需要登录介入的同步失败：直接转入登录并同步流程。
        if (result.reason === 'auth') {
          await connectAndSync();
          return;
        }
        showToast({
          variant: 'error',
          title: '同步课表失败',
          description: result.error ?? '同步失败',
        });
        return;
      }
      await reload();
    };
    await syncTimetable().finally(() => setBusy(false));
  };

  const openNewEvent = (start?: Date, end?: Date) => {
    const startDay = start ?? startOfDay(new Date());
    // 月历拖拽给出的是整天，统一落在 9:00–10:00，弹窗内可再改。
    const startAt = new Date(startDay);
    const endAt = new Date(end ?? startDay);
    startAt.setHours(9, 0, 0, 0);
    endAt.setHours(10, 0, 0, 0);
    setEventDraft({ start: startAt, end: endAt });
  };

  if (!state) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-3">
        {stateQuery.error ? errorMessage(stateQuery.error) : '正在读取课表…'}
      </div>
    );
  }
  const semester = state.semester;

  const weekEnd = addDays(visibleWeekStart, 6);
  const headerTitle =
    mode === 'week'
      ? semesterWeekStart
        ? `${visibleWeekStart.getMonth() + 1}月${visibleWeekStart.getDate()}日 – ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`
        : `第 ${selectedWeek} 教学周`
      : `${month.getFullYear()}年 ${month.getMonth() + 1}月`;

  const step = (direction: -1 | 1) => {
    if (mode === 'week') {
      const next = selectedWeek + direction;
      if (weeks.includes(next)) selectWeek(next);
      return;
    }
    setMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1));
  };

  const goToday = () => {
    if (mode === 'month') return setMonth(startOfDay(new Date()));
    const current = weekForDate(state.semesterStart, new Date());
    selectWeek(current && weeks.includes(current) ? current : (weeks[0] ?? 1));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="border-b border-line bg-surface/95 px-4 py-2 backdrop-blur max-md:px-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{headerTitle}</h1>
            <p className="text-xs text-ink-3">{semesterLabel(semester)}</p>
          </div>
          <div className="flex items-center rounded-control border border-line bg-surface shadow-hairline">
            <Button
              aria-label="上一段时间"
              className="rounded-r-none"
              onClick={() => step(-1)}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronLeft />
            </Button>
            <Button className="rounded-none border-x" onClick={goToday} size="sm" variant="ghost">
              {mode === 'week' ? '本周' : '本月'}
            </Button>
            <Button
              aria-label="下一段时间"
              className="rounded-l-none"
              onClick={() => step(1)}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              aria-label="同步课表"
              disabled={busy}
              onClick={() => void sync()}
              size="icon-sm"
              title={formatSyncTime(state.lastSyncedAt)}
              variant="ghost"
            >
              <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
            </Button>
            <SegmentedControl
              labels={{ week: '周', month: '月' }}
              onChange={setMode}
              options={['week', 'month']}
              value={mode}
            />
            <Button onClick={() => openNewEvent()} size="sm">
              <Plus />
              新建事件
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select onValueChange={setRequestedSemester} value={semester}>
            <SelectTrigger aria-label="学期">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {semesterOptions(semester).map((option) => (
                <SelectItem key={option} value={option}>
                  {semesterLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mode === 'week' ? (
            <Select
              onValueChange={(value) => selectWeek(Number(value))}
              value={String(selectedWeek)}
            >
              <SelectTrigger aria-label="教学周">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weeks.map((week) => (
                  <SelectItem key={week} value={String(week)}>
                    第 {week} 周
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-control bg-fill px-2.5 text-xs font-medium text-ink outline-none transition-colors hover:bg-hover-strong focus-visible:ring-3 focus-visible:ring-accent-tint"
            onClick={() => setSemesterDraft(true)}
            type="button"
          >
            <CalendarRange className="size-3.5 text-ink-3" />
            {state.semesterStart
              ? `开学 ${formatMonthDay(parseDate(state.semesterStart))}`
              : '设置开学日期'}
          </button>
        </div>
      </header>

      {loadError ? (
        <Callout className="mx-4 mt-3" role="alert">
          {errorMessage(loadError)}
        </Callout>
      ) : null}

      {!state.lastSyncedAt ? (
        <TimetableConnectCard semester={semester} />
      ) : mode === 'week' ? (
        <WeekCalendar
          events={semesterWeekStart ? calendarEvents : []}
          lessons={weekLessons}
          onOpen={setDetail}
          weekStart={semesterWeekStart}
        />
      ) : (
        <MonthCalendar
          events={calendarEvents}
          lessons={lessons}
          month={month}
          onCreate={openNewEvent}
          onEditSemesterStart={() => setSemesterDraft(true)}
          semesterStart={state.semesterStart}
        />
      )}

      {eventDraft ? (
        <NewEventDialog
          draft={eventDraft}
          onClose={() => setEventDraft(null)}
          onCreated={() => {
            setEventDraft(null);
            // 课表尚未同步时日历区显示的是登录卡，事件已落库但无处可见，须明确告知。
            if (!state.lastSyncedAt)
              showToast({
                variant: 'success',
                title: '事件已保存',
                description: '同步课表后会在日历中显示',
              });
          }}
        />
      ) : null}

      {semesterDraft ? (
        <SemesterStartDialog
          onClose={() => setSemesterDraft(false)}
          onSaved={() => {
            setSemesterDraft(false);
            void queryClient.invalidateQueries({ queryKey: ['timetable', 'state'] });
          }}
          semester={semester}
          semesterStart={state.semesterStart}
        />
      ) : null}

      {detail ? (
        <EventDetailDialog
          detail={detail}
          onClose={() => setDetail(null)}
          onDeleted={() => setDetail(null)}
          onOpenTodo={(todoId) => {
            setDetail(null);
            navigate({ page: 'todo', todoId });
          }}
        />
      ) : null}
    </div>
  );
}
