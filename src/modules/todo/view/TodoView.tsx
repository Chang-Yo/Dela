import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
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
  X,
} from 'lucide-react';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import {
  todoCompleted,
  todoContract,
  todoStatusLabels,
  type CalendarEventColor,
  type TodoItem,
  type TodoSaveInput,
  type TodoState,
} from '../contract';
import { Button } from '../../../ui/button';
import { useNow } from '../../../ui/use-now';
import { CountBadge } from '../../../ui/count-badge';
import { EmptyState } from '../../../ui/empty-state';
import { Card } from '../../../ui/card';
import { Input } from '../../../ui/input';
import { SegmentedControl } from '../../../ui/segmented-control';
import { Switch } from '../../../ui/switch';
import { cn } from '../../../ui/cn';
import { showToast } from '../../../ui/toast';
import { EventColorRow } from './EventColorRow';
import { formatTime, roundToMinute, startOfDay } from './calendar';
import { DateTimeStepper } from './DateTimeStepper';
import { TodoCalendar } from './TodoCalendar';
import { monthLabel } from './todo-calendar';
import { TodoDetail } from './TodoDetail';
import { TodoSheet } from './TodoSheet';
import { useTodoPreferences } from './preferences';
import { dateLabel } from './todo-format';
import { ErrorText } from '../../../ui/alert';
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

/** 外部链接交给主窗口的打开处理（能在应用内打开的会留在应用内）。 */
function openLink(url: string) {
  window.open(url, '_blank', 'noopener');
}

const inputClass =
  'w-full rounded-control bg-field px-2.5 py-1.5 text-sm text-ink shadow-hairline outline-none transition-[background-color,box-shadow] duration-base placeholder:text-ink-3 focus-visible:bg-surface focus-visible:shadow-focus';

/** 新建待办的默认截止时间取当天结束，避免保存瞬间就被判为「已过截止时间」。 */
function defaultDueAt(): Date {
  const date = new Date();
  date.setHours(23, 59, 0, 0);
  return date;
}

// 行尾操作图标：始终占位避免悬停时行内容位移，悬停/键盘聚焦时浮现，触屏常显。
const rowActionClass =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100';

// 颜色与「写入日历」两行在新建和编辑面板共用，结构与日历新建事件的分组行一致。
function CalendarOptionRows({
  calendar,
  color,
  onCalendarChange,
  onColorChange,
}: {
  calendar: boolean;
  color: CalendarEventColor;
  onCalendarChange: (value: boolean) => void;
  onColorChange: (value: CalendarEventColor) => void;
}) {
  return (
    <>
      <EventColorRow onColorChange={onColorChange} value={color} />
      <div className="flex h-11 items-center gap-2 px-3">
        <span className="w-8 shrink-0 text-xs text-ink-3">日历</span>
        <div className="flex flex-1 items-center justify-between gap-2">
          <span className="text-sm">写入日历</span>
          <Switch checked={calendar} label="写入日历" onChange={onCalendarChange} />
        </div>
      </div>
    </>
  );
}

/** 新建/编辑待办共用的底部滑出面板：标题、备注、截止时间、颜色与写入日历开关。 */
function TodoComposer({
  item,
  busy,
  onCancel,
  onDelete,
  onSave,
}: {
  item?: TodoItem;
  busy: boolean;
  onCancel: () => void;
  onDelete?: () => void;
  onSave: (input: TodoSaveInput) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  // 新建默认到今天结束：取当前时刻会让待办一保存就显示「已过截止时间」。
  // 编辑保留原值，允许为空。
  const [dueAt, setDueAt] = useState<Date | null>(() =>
    item ? (item.dueAt ? roundToMinute(new Date(item.dueAt)) : null) : defaultDueAt(),
  );
  const [calendar, setCalendar] = useState(item?.calendar ?? false);
  const [color, setColor] = useState<CalendarEventColor>(item?.color ?? 'slate');
  return (
    <TodoSheet
      label={item ? '编辑待办' : '新建待办'}
      title={item ? '编辑待办' : '新建待办'}
      onClose={onCancel}
    >
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            id: item?.id,
            title,
            notes,
            dueAt: dueAt ? dueAt.toISOString() : null,
            calendar,
            color,
          });
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
          <div className="flex min-h-11 items-center gap-2 px-3">
            <span className="w-8 shrink-0 text-xs text-ink-3">截止</span>
            <div className="min-w-0 flex-1">
              {dueAt === null ? (
                <Button type="button" variant="outline" onClick={() => setDueAt(defaultDueAt())}>
                  <Plus className="size-4" />
                  设置截止时间
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <DateTimeStepper onChange={setDueAt} value={dueAt} />
                  </div>
                  <button
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-3 transition-colors hover:text-ink"
                    onClick={() => setDueAt(null)}
                    type="button"
                  >
                    <X className="size-3" />
                    清除
                  </button>
                </div>
              )}
            </div>
          </div>
          <CalendarOptionRows
            calendar={calendar}
            color={color}
            onCalendarChange={setCalendar}
            onColorChange={setColor}
          />
        </Card>
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
            <Button disabled={busy || !title.trim()} type="submit">
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
  const [filter, setFilter] = useState<'all' | 'personal' | 'canvas'>('all');
  const [view, setView] = useState<(typeof views)[number]>('calendar');
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const showCompleted = useTodoPreferences((state) => state.showCompleted);
  const [detailId, setDetailId] = useState<string | null>(target.todoId ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 每次跳转都是新对象，据此在渲染中切到它的详情。
  const [shownTarget, setShownTarget] = useState(target);
  if (target !== shownTarget) {
    setShownTarget(target);
    if (target.todoId) {
      setCreating(false);
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
        (filter === 'all' || item.source === filter) &&
        (showCompleted || !todoCompleted(item.status)),
    ) ?? [];
  const pendingCount = (source: 'all' | 'canvas' | 'personal') =>
    (state?.items ?? []).filter(
      (item) => !todoCompleted(item.status) && (source === 'all' || item.source === source),
    ).length;
  const openItem = (id: string) => {
    setDetailId(id);
    void run(() => todo.markRead(id), { failTitle: '标记已读失败' });
  };
  // 月份导航放在页头标题右侧，日历网格只负责展示。
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
          <p className="text-xs text-ink-3">
            {state?.syncedAt
              ? `${formatTime(new Date(state.syncedAt))}更新`
              : state?.connected
                ? 'Canvas 尚未同步'
                : '连接 Canvas 后可同步作业'}
          </p>
          <div className="flex gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="同步作业"
              title="同步作业"
              disabled={busy || state?.syncing || !state?.connected}
              onClick={() => void run(() => todo.refresh(), { failTitle: '同步失败' })}
            >
              <RefreshCw className={cn('size-4', state?.syncing && 'animate-spin')} />
            </Button>
            <Button
              size="sm"
              disabled={!window.dela}
              onClick={() => {
                setCreating(true);
                setEditingId(null);
                setDetailId(null);
              }}
            >
              <Plus className="size-4" />
              新建待办
            </Button>
          </div>
        </div>
      </header>
      {(error || state?.error) && (
        <ErrorText size="sm" className="mt-3 whitespace-pre-wrap">
          {error || state?.error}
        </ErrorText>
      )}
      <div className="flex flex-wrap items-center gap-2 py-4">
        {(['all', 'canvas', 'personal'] as const).map((value) => {
          const count = pendingCount(value);
          return (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? 'secondary' : 'ghost'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? '全部' : value === 'canvas' ? 'Canvas 作业' : '个人待办'}
              {count > 0 && <CountBadge count={count} />}
            </Button>
          );
        })}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* 与「写入日历」同一 Switch 语言，替代原生 checkbox 的默认渲染。 */}
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <Switch
              checked={showCompleted}
              label="显示已完成"
              onChange={(showCompleted) => useTodoPreferences.setState({ showCompleted })}
            />
            显示已完成
          </label>
          <SegmentedControl
            icons={{ calendar: CalendarDays, list: List }}
            labels={{ calendar: '日历', list: '列表' }}
            onChange={setView}
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
          <TodoCalendar items={items} month={month} onOpenItem={(item) => openItem(item.id)} />
        ) : !items.length ? (
          <EmptyState title="暂无符合条件的待办" />
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const done = todoCompleted(item.status);
              const overdue = !done && item.dueAt && Date.parse(item.dueAt) < now;
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
                      {item.source === 'personal' && item.calendar && (
                        <span
                          aria-label="已写入日历"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: `var(--cal-${item.color ?? 'slate'}-bg)` }}
                        />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-3">
                      {item.courseName ?? '个人待办'} · {todoStatusLabels[item.status]}
                    </p>
                    <p className={cn('mt-1 text-xs', overdue ? 'text-danger' : 'text-ink-3')}>
                      {overdue ? '已过截止时间 · ' : ''}
                      {dateLabel(item.dueAt)}
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
                          aria-label={
                            item.calendar ? `取消写入日历 ${item.title}` : `写入日历 ${item.title}`
                          }
                          title={item.calendar ? '取消写入日历' : '写入日历'}
                          onClick={() =>
                            void run(() =>
                              todo.save({
                                id: item.id,
                                title: item.title,
                                calendar: !item.calendar,
                              }),
                            )
                          }
                        >
                          {item.calendar ? (
                            <CalendarCheck className="size-4" />
                          ) : (
                            <CalendarPlus className="size-4" />
                          )}
                        </Button>
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
                          aria-label="在 Canvas 中打开"
                          title="在 Canvas 中打开"
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
        />
      )}
      {(creating || editing) && (
        <TodoComposer
          key={editing ? editing.id : 'new'}
          item={editing}
          busy={busy}
          onCancel={() => {
            setCreating(false);
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
                setCreating(false);
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
