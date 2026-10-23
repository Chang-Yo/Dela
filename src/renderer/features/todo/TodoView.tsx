import { useEffect, useState } from 'react';
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
import type { CalendarEventColor, TodoItem, TodoSaveInput, TodoState } from '../../../shared/api';
import { todoCompleted, todoStatusLabels } from '../../../shared/todo';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { cn } from '../../lib/utils';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { EventColorRow } from '../timetable/EventColorRow';
import { roundToMinute, startOfDay } from '../timetable/timetable-format';
import { DateTimeStepper } from './DateTimeStepper';
import { TodoCalendar } from './TodoCalendar';
import { monthLabel } from './todo-calendar';
import { TodoDetail } from './TodoDetail';
import { TodoSheet } from './TodoSheet';
import { dateLabel } from './todo-format';

const inputClass =
  'w-full rounded-control bg-field px-2.5 py-1.5 text-13 text-ink shadow-hairline outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-ink-3 focus-visible:bg-surface focus-visible:shadow-[0_0_0_1px_var(--bui-accent),0_0_0_3px_var(--bui-accent-tint)]';

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
          <span className="text-13">写入日历</span>
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
  // 新建默认取创建时刻（向下取整到分钟）；编辑保留原值，允许为空。
  const [dueAt, setDueAt] = useState<Date | null>(() =>
    item ? (item.dueAt ? roundToMinute(new Date(item.dueAt)) : null) : roundToMinute(new Date()),
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
          className="h-10 px-0 text-15 font-medium"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：准备小组展示"
          value={title}
          variant="ghost"
        />
        <div className="grid divide-y overflow-hidden rounded-card border border-line">
          <div className="flex min-h-11 items-center gap-2 px-3">
            <span className="w-8 shrink-0 text-xs text-ink-3">截止</span>
            <div className="min-w-0 flex-1">
              {dueAt === null ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDueAt(roundToMinute(new Date()))}
                >
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
        </div>
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

export function TodoView({ request }: { request?: { id: string } }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [state, setState] = useState<TodoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'personal' | 'canvas'>('all');
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [showCompleted, setShowCompleted] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const api = window.dela?.todo;
    if (!api) return;
    let active = true;
    let updated = false;
    const off = api.onUpdate((value) => {
      updated = true;
      if (active) setState(value);
    });
    void api
      .getState()
      .then((value) => {
        if (active && !updated) setState(value);
      })
      .catch((error: unknown) => {
        if (active) setError(errorText(error));
      });
    return () => {
      active = false;
      off();
    };
  }, []);
  useEffect(() => {
    if (!request) return;
    setCreating(false);
    setEditingId(null);
    setDetailId(request.id);
    void window.dela?.todo.markRead(request.id).catch((reason: unknown) => {
      showToast({ variant: 'error', title: '标记已读失败', description: errorText(reason) });
    });
  }, [request]);
  const run = async (
    operation: () => Promise<TodoState>,
    options?: { after?: () => void; failTitle?: string },
  ) => {
    setBusy(true);
    try {
      await operation();
      options?.after?.();
    } catch (reason) {
      showToast({
        variant: 'error',
        title: options?.failTitle ?? '待办操作失败',
        description: errorText(reason),
      });
    } finally {
      setBusy(false);
    }
  };
  const detail = state?.items.find((item) => item.id === detailId);
  const editing = state?.items.find((item) => item.id === editingId);
  const items =
    state?.items.filter(
      (item) =>
        (filter === 'all' || item.source === filter) &&
        (showCompleted || !todoCompleted(item.status)),
    ) ?? [];
  const undatedCount = items.filter((item) => !item.dueAt).length;
  const openItem = (id: string) => {
    setDetailId(id);
    void run(() => window.dela!.todo.markRead(id), { failTitle: '标记已读失败' });
  };
  // 月份导航放在页头副标题位置，日历网格只负责展示。
  const stepMonth = (amount: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
  const goToday = () => {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  };
  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden px-6 py-6 max-md:px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">TODO</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
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
                <Button size="sm" variant="ghost" onClick={goToday}>
                  今天
                </Button>
              </span>
            )}
            <p>
              {state?.syncedAt
                ? `Canvas 更新于 ${dateLabel(state.syncedAt)}`
                : state?.connected
                  ? 'Canvas 尚未同步'
                  : '连接 Canvas 后可同步作业'}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="同步作业"
            title="同步作业"
            disabled={busy || state?.syncing || !state?.connected}
            onClick={() => void run(() => window.dela!.todo.refresh(), { failTitle: '同步失败' })}
          >
            <RefreshCw className={cn('size-4', state?.syncing && 'animate-spin')} />
          </Button>
          <Button
            size="sm"
            disabled={!window.dela?.todo}
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
      </header>
      {(error || state?.error) && (
        <p role="alert" className="mt-3 whitespace-pre-wrap text-13 text-red">
          {error || state?.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 py-4">
        {(['all', 'canvas', 'personal'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'secondary' : 'ghost'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === 'all' ? '全部' : value === 'canvas' ? 'Canvas 作业' : '个人待办'}
          </Button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* 与「写入日历」同一 Switch 语言，替代原生 checkbox 的默认渲染。 */}
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <Switch checked={showCompleted} label="显示已完成" onChange={setShowCompleted} />
            显示已完成
          </label>
          <div
            aria-label="TODO 视图"
            className="flex items-center gap-0.5 rounded-control bg-inset p-0.5"
            role="group"
          >
            <Button
              size="sm"
              variant={view === 'calendar' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'calendar'}
              onClick={() => setView('calendar')}
            >
              <CalendarDays className="size-4" />
              日历
            </Button>
            <Button
              size="sm"
              variant={view === 'list' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'list'}
              title={
                view === 'calendar' && undatedCount > 0
                  ? `${undatedCount} 个待办没有截止时间`
                  : undefined
              }
              onClick={() => setView('list')}
            >
              <List className="size-4" />
              列表
              {view === 'calendar' && undatedCount > 0 && (
                <span className="rounded-full bg-ink px-1.5 text-2xs font-medium leading-4 tabular-nums text-surface">
                  {undatedCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {!state ? (
          <p className="py-8 text-center text-13 text-ink-3">
            {window.dela?.todo ? '正在加载…' : '请在 Dela 桌面端使用 TODO'}
          </p>
        ) : view === 'calendar' ? (
          <TodoCalendar items={items} month={month} onOpenItem={(item) => openItem(item.id)} />
        ) : !items.length ? (
          <p className="py-8 text-center text-13 text-ink-3">暂无符合条件的待办</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const done = todoCompleted(item.status);
              const overdue = !done && item.dueAt && Date.parse(item.dueAt) < now;
              const personal = item.source === 'personal';
              return (
                <li
                  key={item.id}
                  className="group flex items-start gap-3 rounded-card px-3 py-2.5 transition-colors duration-150 hover:bg-hover"
                >
                  {personal ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="mt-0.5 shrink-0 text-ink-3 hover:text-ink"
                      aria-label={done ? `重新打开 ${item.title}` : `完成 ${item.title}`}
                      onClick={() =>
                        void run(() =>
                          window.dela!.todo.save({
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
                      <span className={cn('break-words text-13 font-medium', done && 'text-ink-3')}>
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
                    <p className={cn('mt-1 text-xs', overdue ? 'text-red' : 'text-ink-3')}>
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
                              window.dela!.todo.save({
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
                            void run(() => window.dela!.todo.markRead(item.id), {
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
                            void run(() => window.dela!.todo.remove(item.id), {
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
                          onClick={() =>
                            void window.dela?.canvas.openLink(item.url!).catch((reason: unknown) =>
                              showToast({
                                variant: 'error',
                                title: '打开链接失败',
                                description: errorText(reason),
                              }),
                            )
                          }
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
            void run(() => window.dela!.todo.remove(detail.id), {
              failTitle: '删除待办失败',
            })
          }
          onOpenLink={(url) =>
            void window.dela?.canvas.openLink(url).catch((reason: unknown) =>
              showToast({
                variant: 'error',
                title: '打开链接失败',
                description: errorText(reason),
              }),
            )
          }
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
                  void run(() => window.dela!.todo.remove(editing.id), {
                    after: () => setEditingId(null),
                    failTitle: '删除待办失败',
                  })
              : undefined
          }
          onSave={(input) =>
            void run(() => window.dela!.todo.save(input), {
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
