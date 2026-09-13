import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogIn,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { CalendarEvent, TimetableLesson, TimetableState } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import { MonthCalendar } from './MonthCalendar';
import { NewEventDialog } from './NewEventDialog';
import { SemesterStartDialog } from './SemesterStartDialog';
import { WeekCalendar } from './WeekCalendar';
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

type CalendarMode = 'week' | 'month';

export function TimetableView() {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="教学信息服务网的登录会话和本地课表缓存不会暴露给浏览器。"
        title="课表仅在 Dela 桌面端可用"
      />
    );
  }
  return <DesktopTimetableView />;
}

function DesktopTimetableView() {
  const timetable = window.dela!.timetable;
  const [state, setState] = useState<TimetableState | null>(null);
  const [lessons, setLessons] = useState<TimetableLesson[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [semester, setSemester] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [mode, setMode] = useState<CalendarMode>('week');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<{ start: Date; end: Date } | null>(null);
  const [semesterDraft, setSemesterDraft] = useState(false);

  const loadSemester = useCallback(
    async (requested?: string) => {
      const [nextState, nextLessons] = await Promise.all([
        timetable.getState(requested),
        timetable.listLessons(requested),
      ]);
      setState(nextState);
      setSemester(nextState.semester);
      setLessons([...nextLessons]);
      const currentWeek = weekForDate(nextState.semesterStart, new Date());
      setSelectedWeek(currentWeek && currentWeek > 0 ? currentWeek : 1);
    },
    [timetable],
  );

  useEffect(() => {
    void loadSemester().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [loadSemester]);

  const semesterWeekStart = weekStartFor(state?.semesterStart ?? null, selectedWeek);
  const visibleWeekStart = semesterWeekStart ?? mondayOf(new Date());
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthGridStart = mondayOf(monthStart);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const monthGridEnd = addDays(mondayOf(nextMonth), 7);
  const eventRangeStart = mode === 'week' ? visibleWeekStart : monthGridStart;
  const eventRangeEnd = mode === 'week' ? addDays(visibleWeekStart, 7) : monthGridEnd;

  const loadEvents = useCallback(async () => {
    const nextEvents = await timetable.listEvents(
      eventRangeStart.toISOString(),
      eventRangeEnd.toISOString(),
    );
    setEvents([...nextEvents]);
  }, [timetable, eventRangeStart.getTime(), eventRangeEnd.getTime()]);

  useEffect(() => {
    void loadEvents().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [loadEvents]);

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
      const connected = await timetable.connect();
      if (!connected.ok) return setError(connected.error ?? '未完成登录');
      const result = await timetable.syncNow(semester ?? undefined);
      if (!result.ok) return setError(result.error ?? '同步失败');
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
      if (!result.ok) return setError(result.error ?? '同步失败');
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
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        正在读取课表…
      </div>
    );
  }

  if (!state.connected && lessons.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <section className="grid w-full max-w-[480px] justify-items-start gap-3 rounded-xl border bg-card p-6">
          <div className="grid size-10 place-items-center rounded-lg bg-secondary">
            <CalendarDays className="size-5" />
          </div>
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">连接教学信息服务网</h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              登录后读取课程、教师、教室、节次和教学周。登录在独立窗口完成。
            </p>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button disabled={busy} onClick={() => void connectAndSync()}>
            <LogIn className="size-4" />
            {busy ? '等待登录…' : '登录并同步'}
          </Button>
        </section>
      </div>
    );
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b bg-background/95 px-4 py-2 backdrop-blur max-md:px-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{headerTitle}</h1>
            <p className="text-[11px] text-muted-foreground">
              {mode === 'week' && semesterWeekStart
                ? `第 ${selectedWeek} 教学周 · ${semesterLabel(semester)}`
                : semesterLabel(semester)}
            </p>
          </div>
          <div className="flex items-center rounded-md border bg-background shadow-xs">
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
              aria-label={state.connected ? '同步课表' : '重新登录'}
              disabled={busy}
              onClick={() => void (state.connected ? sync() : connectAndSync())}
              size={state.connected ? 'icon-sm' : 'sm'}
              title={state.connected ? formatSyncTime(state.lastSyncedAt) : undefined}
              variant="ghost"
            >
              {state.connected ? (
                <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
              ) : (
                <LogIn className="size-3.5" />
              )}
              {state.connected ? null : '重新登录'}
            </Button>
            <div className="flex items-center rounded-md bg-secondary p-0.5">
              {(['week', 'month'] as const).map((value) => (
                <button
                  className={cn(
                    'h-7 rounded px-3 text-xs font-medium transition-colors',
                    mode === value
                      ? 'bg-background shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
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
          <HeaderSelect
            label="学期"
            onChange={(value) => {
              setError(null);
              void loadSemester(value).catch((reason: unknown) =>
                setError(reason instanceof Error ? reason.message : String(reason)),
              );
            }}
            value={semester}
          >
            {semesterOptions(semester).map((option) => (
              <option key={option} value={option}>
                {semesterLabel(option)}
              </option>
            ))}
          </HeaderSelect>
          {mode === 'week' ? (
            <HeaderSelect
              label="教学周"
              onChange={(value) => setSelectedWeek(Number(value))}
              value={String(selectedWeek)}
            >
              {weeks.map((week) => (
                <option key={week} value={week}>
                  第 {week} 周
                </option>
              ))}
            </HeaderSelect>
          ) : null}
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-secondary/70 px-2.5 text-xs font-medium text-secondary-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => setSemesterDraft(true)}
            type="button"
          >
            <CalendarRange className="size-3.5 text-muted-foreground" />
            {state.semesterStart
              ? `开学 ${formatMonthDay(parseDate(state.semesterStart))}`
              : '设置开学日期'}
          </button>
        </div>
      </header>

      {error ? (
        <p
          className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {mode === 'week' ? (
        <WeekCalendar
          events={semesterWeekStart ? events : []}
          lessons={weekLessons}
          weekStart={semesterWeekStart}
        />
      ) : (
        <MonthCalendar
          events={events}
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
            void loadSemester(semester).catch((reason: unknown) =>
              setError(reason instanceof Error ? reason.message : String(reason)),
            );
          }}
          semester={semester}
          semesterStart={state.semesterStart}
        />
      ) : null}
    </div>
  );
}

function HeaderSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select
        aria-label={label}
        className="h-8 appearance-none rounded-md bg-secondary/70 pl-2.5 pr-7 text-xs font-medium text-secondary-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
    </span>
  );
}
