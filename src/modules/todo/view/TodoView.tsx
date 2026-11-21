import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheckBig,
  ExternalLink,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import {
  todoContract,
  todoFinished,
  todoOverdue,
  todoStatusLabel,
  todoSyncedAt,
  todoSyncError,
  todoTimeLabel,
  todoTimeSchema,
  type CalendarEventColor,
  type TodoItem,
  type TodoSaveInput,
  type TodoState,
  type TodoTime,
} from '../contract';
import { Button } from '../../../ui/button';
import { useNow } from '../../../ui/hooks/use-now';
import { Badge } from '../../../ui/badge';
import { EmptyState } from '../../../ui/empty-state';
import { Card } from '../../../ui/card';
import { DatePicker } from '../../../ui/date-picker';
import { Input } from '../../../ui/input';
import { SegmentedControl } from '../../../ui/segmented-control';
import { Switch } from '../../../ui/switch';
import { TimePicker } from '../../../ui/time-picker';
import { cn } from '../../../ui/lib/cn';
import { showToast } from '../../../ui/toast';
import { EventColorRow } from './EventColorRow';
import { dateKey, formatTime, roundToMinute, startOfDay } from './calendar';
import { TodoCalendar } from './TodoCalendar';
import { monthLabel } from './todo-calendar';
import { TodoDetail } from './TodoDetail';
import { TodoSheet } from './TodoSheet';
import { useTodoPreferences } from './preferences';
import { ErrorText } from '../../../ui/error-text';
import type { NavTargets } from '../../../app/module';

const views = ['calendar', 'list'] as const;

const todo = createClient(todoContract, window.dela?.bridge);

/** 待办状态的唯一副本：主进程推送 todo:state 时直接写入这一键（docs/adr/0017）。 */
export function useTodoState() {
  return useQuery({ queryKey: ['todo', 'state'], queryFn: () => todo.state() });
}

export function markTodoRead(id: string) {
  void todo
    .markRead(id)
    .catch((reason: unknown) =>
      showToast({ variant: 'error', title: '标记已读失败', description: errorMessage(reason) }),
    );
}

function openLink(url: string) {
  window.open(url, '_blank', 'noopener');
}

const inputClass =
  'w-full rounded-control bg-field px-2.5 py-1.5 text-sm text-ink shadow-hairline outline-none transition-[background-color,box-shadow] duration-base placeholder:text-ink-3 focus-visible:bg-surface focus-visible:shadow-focus';

const rowActionClass =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100';

const timeKinds = ['none', 'due', 'span', 'allDay'] as const;
type TimeKind = (typeof timeKinds)[number];

/** 日历上选中的日期范围，起止都是当天零点。 */
interface TodoDraft {
  start: Date;
  end: Date;
}

interface ComposerTime extends TodoDraft {
  kind: TimeKind;
}

// 截止默认当天结束，免得一保存就算逾期；时段默认上午一小时。
function timeOnDay(kind: TimeKind, day: Date, endDay = day): ComposerTime {
  const at = (date: Date, hour: number, minute = 0) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
  if (kind === 'span') return { kind, start: at(day, 9), end: at(day, 10) };
  if (kind === 'allDay') return { kind, start: at(day, 0), end: at(endDay, 0) };
  return { kind, start: at(day, 23, 59), end: at(day, 23, 59) };
}

function initialTime(item: TodoItem | undefined, draft: TodoDraft | null): ComposerTime {
  if (!item) {
    const today = startOfDay(new Date());
    const { start, end } = draft ?? { start: today, end: today };
    return start.getTime() === end.getTime()
      ? timeOnDay('due', start)
      : timeOnDay('allDay', start, end);
  }
  const time = item.time;
  if (!time) return timeOnDay('none', startOfDay(new Date()));
  if (time.kind === 'due') {
    const at = roundToMinute(new Date(time.at));
    return { kind: time.kind, start: at, end: at };
  }
  if (time.kind === 'span') {
    return {
      kind: time.kind,
      start: roundToMinute(new Date(time.start)),
      end: roundToMinute(new Date(time.end)),
    };
  }
  return {
    kind: time.kind,
    start: new Date(`${time.startDate}T00:00:00`),
    end: new Date(`${time.endDate}T00:00:00`),
  };
}

function ComposerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-2 px-3 py-1.5">
      <span className="w-8 shrink-0 text-xs text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function TodoComposer({
  item,
  draft,
  busy,
  onCancel,
  onDelete,
  onSave,
}: {
  item?: TodoItem;
  draft: TodoDraft | null;
  busy: boolean;
  onCancel: () => void;
  onDelete?: () => void;
  onSave: (input: TodoSaveInput) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [{ kind, start, end }, setTime] = useState(() => initialTime(item, draft));
  const [color, setColor] = useState<CalendarEventColor>(item?.color ?? 'slate');
  // 改开始时结束跟着平移，保持原有时长。
  const moveStart = (next: Date) =>
    setTime({ kind, start: next, end: new Date(end.getTime() + next.getTime() - start.getTime()) });
  const time: TodoTime | null =
    kind === 'none'
      ? null
      : kind === 'due'
        ? { kind, at: start.toISOString() }
        : kind === 'span'
          ? { kind, start: start.toISOString(), end: end.toISOString() }
          : { kind, startDate: dateKey(start), endDate: dateKey(end) };
  const checked = time && todoTimeSchema.safeParse(time);
  const timeError = checked && !checked.success ? checked.error.issues[0]?.message : null;
  return (
    <TodoSheet title={item ? '编辑待办' : '新建待办'} onClose={onCancel}>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ id: item?.id, title, notes, time, color });
        }}
      >
        <Input
          autoFocus
          className="h-10 px-0 text-base font-medium"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：准备小组展示"
          value={title}
          variant="ghost"
        />
        <Card className="grid divide-y">
          <div className="flex h-11 items-center gap-2 px-3">
            <span className="w-8 shrink-0 text-xs text-ink-3">时间</span>
            <SegmentedControl
              aria-label="时间类型"
              labels={{ none: '无', due: '截止', span: '时段', allDay: '全天' }}
              onValueChange={(next) => setTime(timeOnDay(next, startOfDay(start)))}
              options={timeKinds}
              value={kind}
            />
          </div>
          {kind === 'due' && (
            <ComposerRow label="截止">
              <DatePicker aria-label="截止日期" onValueChange={moveStart} value={start} />
              <TimePicker aria-label="截止时刻" onValueChange={moveStart} value={start} />
            </ComposerRow>
          )}
          {kind === 'span' && (
            <ComposerRow label="时段">
              <DatePicker aria-label="日期" onValueChange={moveStart} value={start} />
              <TimePicker aria-label="开始时刻" onValueChange={moveStart} value={start} />
              <span className="text-ink-3">–</span>
              <TimePicker
                aria-label="结束时刻"
                onValueChange={(next) => setTime({ kind, start, end: next })}
                value={end}
              />
            </ComposerRow>
          )}
          {kind === 'allDay' && (
            <ComposerRow label="日期">
              <DatePicker aria-label="开始日期" onValueChange={moveStart} value={start} />
              <span className="text-ink-3">–</span>
              <DatePicker
                aria-label="结束日期"
                onValueChange={(next) => setTime({ kind, start, end: next })}
                value={end}
              />
            </ComposerRow>
          )}
          <EventColorRow onColorChange={setColor} value={color} />
        </Card>
        {timeError && <ErrorText size="sm">{timeError}</ErrorText>}
        <textarea
          aria-label="备注"
          className={cn(inputClass, 'min-h-20 resize-y')}
          maxLength={10000}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="备注"
          rows={3}
          value={notes}
        />
        <div className="flex items-center justify-between gap-2">
          {item && onDelete ? (
            <Button
              variant="ghost"
              aria-label="删除待办"
              title="删除待办"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              取消
            </Button>
            <Button disabled={busy || !title.trim() || !!timeError} type="submit">
              保存
            </Button>
          </div>
        </div>
      </form>
    </TodoSheet>
  );
}

export function TodoView({ target }: { target: NavTargets['todo'] }) {
  const now = useNow(60_000);
  const query = useTodoState();
  const state = query.data ?? null;
  const error = query.error ? errorMessage(query.error) : null;
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState<(typeof views)[number]>('calendar');
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const showCompleted = useTodoPreferences((state) => state.showCompleted);
  const [detailId, setDetailId] = useState<string | null>(target.todoId ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState<TodoDraft | null>(null);
  // 每次跳转都是新对象，据此在渲染中切到它的详情。
  const [shownTarget, setShownTarget] = useState(target);
  if (target !== shownTarget) {
    setShownTarget(target);
    if (target.todoId) {
      setCreating(null);
      setEditingId(null);
      setDetailId(target.todoId);
    }
  }
  const run = async (
    operation: () => Promise<TodoState>,
    options?: { after?: () => void; failTitle?: string },
  ) => {
    setBusy(true);
    const after = options?.after;
    const failTitle = options?.failTitle ?? '待办操作失败';
    try {
      await operation();
      if (after) after();
    } catch (reason) {
      showToast({
        variant: 'error',
        title: failTitle,
        description: errorMessage(reason),
      });
    }
    setBusy(false);
  };
  const detail = state?.items.find((item) => item.id === detailId);
  const editing = state?.items.find((item) => item.id === editingId);
  const items =
    state?.items.filter(
      (item) =>
        (filter === 'all' || item.source === filter) && (showCompleted || !todoFinished(item, now)),
    ) ?? [];
  const pendingCount = (source: string) =>
    (state?.items ?? []).filter(
      (item) => !todoFinished(item, now) && (source === 'all' || item.source === source),
    ).length;
  const startCreating = (draft: TodoDraft) => {
    setCreating(draft);
    setEditingId(null);
    setDetailId(null);
  };
  const sources = state?.sources ?? [];
  const connected = sources.some((source) => source.connected);
  const syncedAt = state ? todoSyncedAt(state) : null;
  const syncError = state ? todoSyncError(state) : null;
  const openLabel = (item: TodoItem) =>
    sources.find((source) => source.id === item.source)?.openLabel ?? '打开原页面';
  const filters = [
    { value: 'all', label: '全部' },
    ...sources.map((source) => ({ value: source.id, label: source.label })),
    { value: 'personal', label: '个人待办' },
  ];
  const openItem = (id: string) => {
    setDetailId(id);
    void run(() => todo.markRead(id), { failTitle: '标记已读失败' });
  };
  const stepMonth = (amount: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden px-6 py-6 max-md:px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">TODO</h1>
          {view === 'calendar' && (
            <span className="flex items-center gap-0.5">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="上个月"
                onClick={() => stepMonth(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-28 text-center text-sm font-medium tabular-nums text-ink">
                {monthLabel(month)}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="下个月"
                onClick={() => stepMonth(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {connected && (
            <p className="text-xs text-ink-3">
              {syncedAt ? `${formatTime(new Date(syncedAt))}更新` : '尚未同步'}
            </p>
          )}
          <div className="flex gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="同步"
              title="同步"
              disabled={busy || state?.syncing || !connected}
              onClick={() => void run(() => todo.refresh(), { failTitle: '同步失败' })}
            >
              <RefreshCw className={cn('size-4', state?.syncing && 'animate-spin')} />
            </Button>
            <Button
              size="sm"
              disabled={!window.dela}
              onClick={() => {
                const today = startOfDay(new Date());
                startCreating({ start: today, end: today });
              }}
            >
              <Plus className="size-4" />
              新建待办
            </Button>
          </div>
        </div>
      </header>
      {(error || syncError) && (
        <ErrorText size="sm" className="mt-3 whitespace-pre-wrap">
          {error || syncError}
        </ErrorText>
      )}
      <div className="flex flex-wrap items-center gap-2 py-4">
        {filters.map(({ value, label }) => {
          const count = pendingCount(value);
          return (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? 'secondary' : 'ghost'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              {count > 0 && <Badge variant="count" count={count} />}
            </Button>
          );
        })}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <Switch
              checked={showCompleted}
              aria-label="显示已完成"
              onCheckedChange={(showCompleted) => useTodoPreferences.setState({ showCompleted })}
            />
            显示已完成
          </label>
          <SegmentedControl
            icons={{ calendar: CalendarDays, list: List }}
            labels={{ calendar: '日历', list: '列表' }}
            onValueChange={setView}
            options={views}
            value={view}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {!state ? (
          <p className="py-8 text-center text-sm text-ink-3">
            {window.dela ? '正在加载…' : '请在 Dela 桌面端使用 TODO'}
          </p>
        ) : view === 'calendar' ? (
          <TodoCalendar
            items={items}
            month={month}
            onCreate={(start, end) => {
              if (window.dela) startCreating({ start, end });
            }}
            onOpenItem={(item) => openItem(item.id)}
          />
        ) : !items.length ? (
          <EmptyState title="暂无符合条件的待办" />
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const done = item.status === 'done';
              const overdue = todoOverdue(item, now);
              const personal = item.source === 'personal';
              return (
                <li
                  key={item.id}
                  className="group flex items-start gap-3 rounded-card px-3 py-2.5 transition-colors duration-base hover:bg-hover"
                >
                  {personal ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="mt-0.5 shrink-0 text-ink-3 hover:text-ink"
                      aria-label={done ? `重新打开 ${item.title}` : `完成 ${item.title}`}
                      onClick={() =>
                        void run(() =>
                          todo.save({
                            id: item.id,
                            title: item.title,
                            completed: !done,
                          }),
                        )
                      }
                    >
                      {done ? <CircleCheckBig className="size-5" /> : <Circle className="size-5" />}
                    </button>
                  ) : (
                    <CircleCheckBig
                      aria-hidden="true"
                      className={cn('mt-0.5 size-5 shrink-0', done ? 'text-ink' : 'text-ink-3')}
                    />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openItem(item.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('break-words text-sm font-medium', done && 'text-ink-3')}>
                        {item.title}
                      </span>
                      {!item.readAt && (
                        <span aria-label="未读" className="size-1.5 shrink-0 rounded-full bg-ink" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-3">
                      {item.group?.label ?? '个人待办'} · {todoStatusLabel(item)}
                    </p>
                    <p className={cn('mt-1 text-xs', overdue ? 'text-danger' : 'text-ink-3')}>
                      {overdue ? '已过截止时间 · ' : ''}
                      {todoTimeLabel(item.time)}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 self-center">
                    {personal ? (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={busy}
                          className={rowActionClass}
                          aria-label={`编辑 ${item.title}`}
                          title="编辑"
                          onClick={() => {
                            setDetailId(null);
                            setEditingId(item.id);
                            void run(() => todo.markRead(item.id), {
                              failTitle: '标记已读失败',
                            });
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={busy}
                          className={rowActionClass}
                          aria-label={`删除 ${item.title}`}
                          title="删除"
                          onClick={() =>
                            void run(() => todo.remove(item.id), {
                              failTitle: '删除待办失败',
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : (
                      item.url && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className={rowActionClass}
                          aria-label={openLabel(item)}
                          title={openLabel(item)}
                          onClick={() => openLink(item.url!)}
                        >
                          <ExternalLink className="size-4" />
                        </Button>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {detail && (
        <TodoDetail
          item={detail}
          now={now}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setEditingId(detail.id);
          }}
          onDelete={() =>
            void run(() => todo.remove(detail.id), {
              failTitle: '删除待办失败',
            })
          }
          onOpenLink={openLink}
          openLabel={openLabel(detail)}
        />
      )}
      {(creating || editing) && (
        <TodoComposer
          key={editing ? editing.id : 'new'}
          item={editing}
          draft={creating}
          busy={busy}
          onCancel={() => {
            setCreating(null);
            setEditingId(null);
          }}
          onDelete={
            editing
              ? () =>
                  void run(() => todo.remove(editing.id), {
                    after: () => setEditingId(null),
                    failTitle: '删除待办失败',
                  })
              : undefined
          }
          onSave={(input) =>
            void run(() => todo.save(input), {
              after: () => {
                setCreating(null);
                setEditingId(null);
              },
              failTitle: '保存待办失败',
            })
          }
        />
      )}
    </div>
  );
}
