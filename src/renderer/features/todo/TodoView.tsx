import { useEffect, useState } from 'react';
import { Circle, CircleCheckBig, ExternalLink, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { CalendarEventColor, TodoItem, TodoSaveInput, TodoState } from '../../../shared/api';
import { todoCompleted, todoStatusLabels } from '../../../shared/todo';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { eventPalette, roundToMinute } from '../timetable/timetable-format';
import { DateTimeStepper } from './DateTimeStepper';

function dateLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '无截止日期';
}

const inputClass =
  'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        checked ? 'bg-primary' : 'bg-input',
      )}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'block size-4 rounded-full bg-background shadow-sm transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

// 颜色与「写入日历」两行在新建面板和编辑表单共用，结构与日历新建事件的分组行一致。
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
      <div className="flex h-11 items-center gap-2 px-3">
        <span className="w-8 shrink-0 text-xs text-muted-foreground">颜色</span>
        <div className="flex flex-1 items-center gap-1.5">
          {eventPalette.map(({ key, label }) => (
            <button
              aria-label={label}
              aria-pressed={color === key}
              className={cn(
                'size-5 rounded-full outline-offset-2 transition-transform hover:scale-110',
                color === key && 'ring-2 ring-ring ring-offset-2 ring-offset-card',
              )}
              key={key}
              onClick={() => onColorChange(key)}
              style={{ backgroundColor: `var(--cal-${key}-bg)` }}
              title={label}
              type="button"
            />
          ))}
        </div>
      </div>
      <div className="flex h-11 items-center gap-2 px-3">
        <span className="w-8 shrink-0 text-xs text-muted-foreground">日历</span>
        <div className="flex flex-1 items-center justify-between gap-2">
          <span className="text-sm">写入日历</span>
          <Switch checked={calendar} label="写入日历" onChange={onCalendarChange} />
        </div>
      </div>
    </>
  );
}

function DeadlineField({
  dueAt,
  onChange,
}: {
  dueAt: Date | null;
  onChange: (value: Date | null) => void;
}) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span>截止时间</span>
        {dueAt !== null && (
          <button
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onChange(null)}
            type="button"
          >
            <X className="size-3" />
            清除
          </button>
        )}
      </div>
      {dueAt === null ? (
        <Button type="button" variant="outline" onClick={() => onChange(roundToMinute(new Date()))}>
          <Plus className="size-4" />
          设置截止时间
        </Button>
      ) : (
        <DateTimeStepper onChange={onChange} value={dueAt} />
      )}
    </div>
  );
}

function TodoForm({
  item,
  onSave,
  onCancel,
  busy,
}: {
  item?: TodoItem;
  onSave: (input: TodoSaveInput) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [dueAt, setDueAt] = useState<Date | null>(() =>
    item?.dueAt ? roundToMinute(new Date(item.dueAt)) : null,
  );
  const [calendar, setCalendar] = useState(item?.calendar ?? false);
  const [color, setColor] = useState<CalendarEventColor>(item?.color ?? 'slate');
  return (
    <form
      className="space-y-4"
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
      <label className="block space-y-2 text-sm">
        <span>标题</span>
        <input
          autoFocus
          required
          maxLength={200}
          className={inputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <DeadlineField dueAt={dueAt} onChange={setDueAt} />
      <div className="overflow-hidden rounded-lg border">
        <CalendarOptionRows
          calendar={calendar}
          color={color}
          onCalendarChange={setCalendar}
          onColorChange={setColor}
        />
      </div>
      <label className="block space-y-2 text-sm">
        <span>备注</span>
        <textarea
          rows={4}
          maxLength={10000}
          className={inputClass}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button disabled={busy || !title.trim()} type="submit">
          保存
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

/** 新建待办的底部滑出面板：标题、备注、步进式截止时间、颜色与写入日历开关。 */
function TodoComposer({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (input: TodoSaveInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  // 默认取创建时刻的系统时间（向下取整到分钟），再经步进微调。
  const [dueAt, setDueAt] = useState(() => roundToMinute(new Date()));
  const [calendar, setCalendar] = useState(false);
  const [color, setColor] = useState<CalendarEventColor>('slate');
  return (
    <div
      className="absolute inset-0 z-40"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        onMouseDown={onCancel}
      />
      <section
        aria-label="新建待办"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[calc(100%-2rem)] w-full max-w-xl animate-in flex-col overflow-y-auto rounded-t-2xl border bg-card p-5 shadow-2xl fade-in slide-in-from-bottom-6 duration-200 max-md:px-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">新建待办</h2>
          <Button
            aria-label="关闭"
            className="-mr-2"
            onClick={onCancel}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ title, notes, dueAt: dueAt.toISOString(), calendar, color });
          }}
        >
          <Input
            autoFocus
            className="h-10 border-0 bg-transparent px-0 text-[15px] font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：准备小组展示"
            value={title}
          />
          <div className="grid divide-y overflow-hidden rounded-lg border">
            <div className="flex items-start gap-2 px-3 py-3">
              <span className="w-8 shrink-0 pt-1 text-xs text-muted-foreground">截止</span>
              <div className="flex-1">
                <DateTimeStepper onChange={setDueAt} value={dueAt} />
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              取消
            </Button>
            <Button disabled={busy || !title.trim()} type="submit">
              保存
            </Button>
          </div>
        </form>
      </section>
    </div>
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
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
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
        if (active) setError(String(error));
      });
    return () => {
      active = false;
      off();
    };
  }, []);
  useEffect(() => {
    if (!request) return;
    setSelectedId(request.id);
    setCreating(false);
    setEditing(false);
    let active = true;
    void window.dela?.todo.markRead(request.id).catch((error: unknown) => {
      if (active) setError(String(error));
    });
    return () => {
      active = false;
    };
  }, [request]);
  const run = async (operation: () => Promise<TodoState>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      after?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const selected = state?.items.find((item) => item.id === selectedId);
  const items =
    state?.items.filter(
      (item) =>
        (filter === 'all' || item.source === filter) &&
        (showCompleted || !todoCompleted(item.status)),
    ) ?? [];
  const completedCount = state?.items.filter((item) => todoCompleted(item.status)).length ?? 0;
  const detailOpen = selectedId !== null;
  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden px-6 py-6 max-md:px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">TODO</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {state?.syncedAt
              ? `Canvas 更新于 ${dateLabel(state.syncedAt)}`
              : state?.connected
                ? 'Canvas 尚未同步'
                : '连接 Canvas 后可同步作业'}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="同步作业"
            title="同步作业"
            disabled={busy || state?.syncing || !state?.connected}
            onClick={() => void run(() => window.dela!.todo.refresh())}
          >
            <RefreshCw className={cn('size-4', state?.syncing && 'animate-spin')} />
          </Button>
          <Button
            size="sm"
            disabled={!window.dela?.todo}
            onClick={() => {
              setCreating(true);
              setEditing(false);
              setSelectedId(null);
            }}
          >
            <Plus className="size-4" />
            新建待办
          </Button>
        </div>
      </header>
      {(error || state?.error) && (
        <p role="alert" className="mt-3 whitespace-pre-wrap text-sm text-destructive">
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
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(event) => setShowCompleted(event.target.checked)}
          />
          显示已完成（{completedCount}）
        </label>
      </div>
      <div className="flex min-h-0 flex-1 gap-6 max-md:flex-col max-md:overflow-y-auto">
        <div
          className={cn(
            'min-w-0 flex-1 overflow-y-auto max-md:overflow-visible',
            detailOpen && 'max-md:hidden',
          )}
        >
          {!state ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {window.dela?.todo ? '正在加载…' : '请在 Dela 桌面端使用 TODO'}
            </p>
          ) : !items.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无符合条件的待办</p>
          ) : (
            <ul className="space-y-1">
              {items.map((item) => {
                const done = todoCompleted(item.status);
                const overdue = !done && item.dueAt && Date.parse(item.dueAt) < now;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'flex items-start gap-3 rounded-lg px-3 py-3',
                      selectedId === item.id ? 'bg-accent' : 'hover:bg-muted/50',
                    )}
                  >
                    {item.source === 'personal' ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
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
                        {done ? (
                          <CircleCheckBig className="size-5" />
                        ) : (
                          <Circle className="size-5" />
                        )}
                      </button>
                    ) : (
                      <CircleCheckBig
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 size-5 shrink-0',
                          done ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                    )}
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setSelectedId(item.id);
                        setCreating(false);
                        setEditing(false);
                        void run(() => window.dela!.todo.markRead(item.id));
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'break-words text-sm font-medium',
                            done && 'text-muted-foreground',
                          )}
                        >
                          {item.title}
                        </span>
                        {!item.readAt && (
                          <span
                            aria-label="未读"
                            className="size-1.5 shrink-0 rounded-full bg-primary"
                          />
                        )}
                        {item.source === 'personal' && item.calendar && (
                          <span
                            aria-label="已写入日历"
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: `var(--cal-${item.color ?? 'slate'}-bg)` }}
                          />
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.courseName ?? '个人待办'} · {todoStatusLabels[item.status]}
                      </p>
                      <p
                        className={cn(
                          'mt-1 text-xs',
                          overdue ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {overdue ? '已过截止时间 · ' : ''}
                        {dateLabel(item.dueAt)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {detailOpen && (
          <section
            aria-label="待办详情"
            className="min-w-0 flex-1 overflow-y-auto border-l pl-6 max-md:border-l-0 max-md:pl-0"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-medium">待办详情</h2>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="关闭详情"
                onClick={() => {
                  setEditing(false);
                  setSelectedId(null);
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
            {editing && selected?.source === 'personal' ? (
              <TodoForm
                key={selected.id}
                item={selected}
                busy={busy}
                onCancel={() => setEditing(false)}
                onSave={(input) =>
                  void run(
                    () => window.dela!.todo.save(input),
                    () => setEditing(false),
                  )
                }
              />
            ) : selected ? (
              <>
                <h3 className="break-words text-lg font-medium">{selected.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground">
                  {selected.courseName ?? '个人待办'} · {todoStatusLabels[selected.status]}
                </p>
                <p className="mt-2 text-sm">截止：{dateLabel(selected.dueAt)}</p>
                {selected.source === 'personal' && selected.calendar && (
                  <p className="mt-2 text-xs text-muted-foreground">已写入日历</p>
                )}
                {selected.submittedAt && (
                  <p className="mt-2 text-sm">提交于：{dateLabel(selected.submittedAt)}</p>
                )}
                {selected.syncedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    状态更新于 {dateLabel(selected.syncedAt)}
                  </p>
                )}
                {selected.notes && (
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm">{selected.notes}</p>
                )}
                <div className="mt-6 flex flex-wrap gap-2">
                  {selected.source === 'canvas' ? (
                    selected.url && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void window.dela?.canvas
                            .openLink(selected.url!)
                            .catch((error: unknown) => setError(String(error)))
                        }
                      >
                        <ExternalLink className="size-4" />在 Canvas 中查看
                      </Button>
                    )
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => setEditing(true)}>
                        编辑
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="删除待办"
                        title="删除待办"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => window.dela!.todo.remove(selected.id),
                            () => setSelectedId(null),
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                这条待办已不存在或不属于当前 Canvas 连接。
              </p>
            )}
          </section>
        )}
      </div>
      {creating && (
        <TodoComposer
          busy={busy}
          onCancel={() => setCreating(false)}
          onSave={(input) =>
            void run(
              () => window.dela!.todo.save(input),
              () => setCreating(false),
            )
          }
        />
      )}
    </div>
  );
}
