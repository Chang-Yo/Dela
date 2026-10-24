import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import type { CalendarEvent, TimetableLesson, TimetableState, TodoItem } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { MonthCalendar } from './MonthCalendar';
import { NewEventDialog } from './NewEventDialog';
import { SemesterStartDialog } from './SemesterStartDialog';
import { TimetableConnectCard } from './TimetableConnectCard';
import { connectAndSyncTimetable } from './timetable-connect';
import { WeekCalendar, type CalendarItemDetail } from './WeekCalendar';
import { EventDetailDialog } from './EventDetailDialog';
import {
  activeInWeek,
  addDays,
  formatMonthDay,
  formatSyncTime,
  mondayOf,
  parseDate,
  semesterLabel,
  semesterOptions,
  startOfDay,
  weekForDate,
  weekStartFor,
} from './timetable-format';
import { cn } from '../../lib/utils';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';

type CalendarMode = 'week' | 'month';

/** 学期/事件请求序号：丢弃过期响应（与水源 store 的 request guard 同法）。 */
let semesterRequest = 0;
let eventsRequest = 0;

export function TimetableView({ onOpenTodo }: { onOpenTodo?: (todoId: string) => void }) {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="教学信息服务网的登录会话和本地课表缓存不会暴露给浏览器。"
        title="课表仅在 Dela 桌面端可用"
      />
    );
  }
  return <DesktopTimetableView onOpenTodo={onOpenTodo} />;
}

function DesktopTimetableView({ onOpenTodo }: { onOpenTodo?: (todoId: string) => void }) {
  const timetable = window.dela!.timetable;
  const [state, setState] = useState<TimetableState | null>(null);
  const [lessons, setLessons] = useState<TimetableLesson[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [semester, setSemester] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [mode, setMode] = useState<CalendarMode>('week');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<{ start: Date; end: Date } | null>(null);
  const [semesterDraft, setSemesterDraft] = useState(false);
  const [detail, setDetail] = useState<CalendarItemDetail | null>(null);
  /** 上次已加载的学期：据此判断是否把选中周归位到本周。 */
  const loadedSemesterRef = useRef<string | null>(null);

  const loadSemester = useCallback(
    async (requested?: string) => {
      const request = ++semesterRequest;
      const [nextState, nextLessons] = await Promise.all([
        timetable.getState(requested),
        timetable.listLessons(requested),
      ]);
      if (semesterRequest !== request) return;
      setState(nextState);
      setSemester(nextState.semester);
      setLessons([...nextLessons]);
      // 学期未变时保留用户选中的教学周：同步/改开学日期不应把用户拉回本周。
      if (loadedSemesterRef.current === nextState.semester) return;
      loadedSemesterRef.current = nextState.semester;
      const currentWeek = weekForDate(nextState.semesterStart, new Date());
      setSelectedWeek(currentWeek && currentWeek > 0 ? currentWeek : 1);
    },
    [timetable],
  );

  useEffect(() => {
    void loadSemester().catch((reason: unknown) => setError(errorText(reason)));
  }, [loadSemester]);

  const semesterWeekStart = weekStartFor(state?.semesterStart ?? null, selectedWeek);
  const visibleWeekStart = semesterWeekStart ?? mondayOf(new Date());
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthGridStart = mondayOf(monthStart);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const monthGridEnd = addDays(mondayOf(nextMonth), 7);
  const eventRangeStart = mode === 'week' ? visibleWeekStart : monthGridStart;
  const eventRangeEnd = mode === 'week' ? addDays(visibleWeekStart, 7) : monthGridEnd;

  // 写入日历的个人待办派生为 30 分钟事件块、止于截止时刻；id 走 `todo:` 前缀命名空间。
  const todoEvents = useMemo(() => {
    const rangeStart = eventRangeStart.getTime();
    const rangeEnd = eventRangeEnd.getTime();
    return todoItems.flatMap((todo) => {
      if (todo.source !== 'personal' || !todo.calendar || !todo.dueAt) return [];
      const dueAt = Date.parse(todo.dueAt);
      if (dueAt < rangeStart || dueAt > rangeEnd) return [];
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
    // 依赖写法沿用 .getTime() 内联形式：React Compiler 无法证明派生数值稳定，具名 deps 会触发
    // preserve-manual-memoization 告警。
  }, [todoItems, eventRangeStart.getTime(), eventRangeEnd.getTime()]);
  const calendarEvents = useMemo(() => [...events, ...todoEvents], [events, todoEvents]);

  const loadEvents = useCallback(async () => {
    const request = ++eventsRequest;
    const nextEvents = await timetable.listEvents(
      eventRangeStart.toISOString(),
      eventRangeEnd.toISOString(),
    );
    if (eventsRequest !== request) return;
    setEvents([...nextEvents]);
    // 依赖写法沿用 .getTime() 内联形式：React Compiler 无法证明派生数值稳定，具名 deps 会触发
    // preserve-manual-memoization 告警。
  }, [timetable, eventRangeStart.getTime(), eventRangeEnd.getTime()]);

  useEffect(() => {
    void loadEvents().catch((reason: unknown) => setError(errorText(reason)));
  }, [loadEvents]);

  // Run 终态后刷新课表（日历只可能被 Agent 工具在 run 中写入；个人待办另有 todo.onUpdate 驱动）。
  // 后台自动刷新失败不写错误横幅（横幅只承载用户触发的加载失败），仅留诊断线索。
  useEffect(
    () =>
      window.dela?.session.onRunEvent((event) => {
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'stopped')
          void loadEvents().catch((reason) =>
            console.error('[timetable] 自动刷新课表失败', reason),
          );
      }),
    [loadEvents],
  );

  // 写入日历的个人待办由待办状态广播驱动：增删改后无需手动刷新日历。
  useEffect(() => {
    const api = window.dela?.todo;
    if (!api) return;
    let active = true;
    const off = api.onUpdate((value) => setTodoItems(value.items));
    void api
      .getState()
      .then((value) => {
        if (active) setTodoItems(value.items);
      })
      .catch((reason: unknown) => console.warn('[timetable] 加载个人待办失败', reason));
    return () => {
      active = false;
      off();
    };
  }, []);

  const weeks = useMemo(() => {
    const found = [...new Set(lessons.flatMap((lesson) => lesson.weekNumbers))].sort(
      (a, b) => a - b,
    );
    return found.length ? found : Array.from({ length: 18 }, (_, index) => index + 1);
  }, [lessons]);
  const weekLessons = useMemo(
    () => lessons.filter((lesson) => activeInWeek(lesson, selectedWeek)),
    [lessons, selectedWeek],
  );

  const connectAndSync = async () => {
    setBusy(true);
    setError(null);
    try {
      const failure = await connectAndSyncTimetable(semester ?? undefined);
      if (failure) {
        showToast({ variant: 'error', title: '登录同步失败', description: failure });
        return;
      }
      await loadSemester(semester ?? undefined);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await timetable.syncNow(semester ?? undefined);
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
      await loadSemester(semester ?? undefined);
    } finally {
      setBusy(false);
    }
  };

  const openNewEvent = (start: Date = startOfDay(new Date()), end: Date = start) => {
    // 月历拖拽给出的是整天，统一落在 9:00–10:00，弹窗内可再改。
    const startAt = new Date(start);
    const endAt = new Date(end);
    startAt.setHours(9, 0, 0, 0);
    endAt.setHours(10, 0, 0, 0);
    setEventDraft({ start: startAt, end: endAt });
  };

  if (!state || !semester) {
    return <div className="grid h-full place-items-center text-13 text-ink-3">正在读取课表…</div>;
  }

  const weekEnd = addDays(visibleWeekStart, 6);
  const headerTitle =
    mode === 'week'
      ? semesterWeekStart
        ? `${visibleWeekStart.getMonth() + 1}月${visibleWeekStart.getDate()}日 – ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`
        : `第 ${selectedWeek} 教学周`
      : `${month.getFullYear()}年 ${month.getMonth() + 1}月`;

  const navigate = (direction: -1 | 1) => {
    if (mode === 'week') {
      const next = selectedWeek + direction;
      if (weeks.includes(next)) setSelectedWeek(next);
      return;
    }
    setMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1));
  };

  const goToday = () => {
    if (mode === 'month') return setMonth(startOfDay(new Date()));
    const current = weekForDate(state.semesterStart, new Date());
    setSelectedWeek(current && weeks.includes(current) ? current : (weeks[0] ?? 1));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="border-b border-line bg-surface/95 px-4 py-2 backdrop-blur max-md:px-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{headerTitle}</h1>
            {/* 周次信息已由下方「教学周」Select 展示，副标题只保留学期，避免同屏重复。 */}
            <p className="text-2xs text-ink-3">{semesterLabel(semester)}</p>
          </div>
          <div className="flex items-center rounded-control border border-line bg-surface shadow-hairline">
            <Button
              aria-label="上一段时间"
              className="rounded-r-none"
              onClick={() => navigate(-1)}
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
              onClick={() => navigate(1)}
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
            <div className="flex items-center rounded-control bg-hover-2 p-0.5">
              {(['week', 'month'] as const).map((value) => (
                <button
                  className={cn(
                    'h-7 rounded px-3 text-xs font-medium transition-colors',
                    mode === value ? 'bg-surface shadow-hairline' : 'text-ink-3 hover:text-ink',
                  )}
                  key={value}
                  onClick={() => setMode(value)}
                >
                  {value === 'week' ? '周' : '月'}
                </button>
              ))}
            </div>
            <Button onClick={() => openNewEvent()} size="sm">
              <Plus />
              新建事件
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            onValueChange={(value) => {
              setError(null);
              void loadSemester(value).catch((reason: unknown) => setError(errorText(reason)));
            }}
            value={semester}
          >
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
              onValueChange={(value) => setSelectedWeek(Number(value))}
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
            className="inline-flex h-8 items-center gap-1.5 rounded-control bg-hover-2 px-2.5 text-xs font-medium text-ink outline-none transition-colors hover:bg-hover-2 focus-visible:ring-[3px] focus-visible:ring-bui-accent-tint"
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

      {error ? (
        <p
          className="mx-4 mt-3 break-words rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-xs text-red"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {!state.lastSyncedAt ? (
        <div className="grid flex-1 place-items-center p-6">
          <TimetableConnectCard semester={semester} onSuccess={() => void loadSemester(semester)} />
        </div>
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
            void loadEvents();
          }}
        />
      ) : null}

      {semesterDraft ? (
        <SemesterStartDialog
          onClose={() => setSemesterDraft(false)}
          onSaved={() => {
            setSemesterDraft(false);
            setError(null);
            void loadSemester(semester).catch((reason: unknown) => setError(errorText(reason)));
          }}
          semester={semester}
          semesterStart={state.semesterStart}
        />
      ) : null}

      {detail ? (
        <EventDetailDialog
          detail={detail}
          onClose={() => setDetail(null)}
          onDeleted={() => {
            setDetail(null);
            void loadEvents();
          }}
          onOpenTodo={(todoId) => {
            setDetail(null);
            onOpenTodo?.(todoId);
          }}
        />
      ) : null}
    </div>
  );
}
