import { useState } from 'react';
import { Popover } from 'radix-ui';
import type { TodoItem } from '../../../shared/api';
import { todoCompleted } from '../../../shared/todo';
import { menuPanel } from '../../components/ui/menu-styles';
import { cn } from '../../lib/utils';
import {
  dateKey,
  eventColorStyle,
  formatMonthDay,
  formatTime,
  weekDays,
} from '../timetable/timetable-format';
import { groupTodosByDay, monthGridDays, todoCalendarColor } from './todo-calendar';

function TodoChip({ item, onOpen }: { item: TodoItem; onOpen: (item: TodoItem) => void }) {
  const done = todoCompleted(item.status);
  const time = item.dueAt ? formatTime(new Date(item.dueAt)) : '';
  const course = item.courseName ?? '个人待办';
  return (
    <button
      type="button"
      aria-label={`打开 ${item.title}，${course}${time ? `，${time}` : ''}${done ? '，已完成' : ''}`}
      className={cn(
        'flex h-5 min-w-0 items-center gap-1 rounded px-1.5 text-left text-2xs transition-opacity duration-100 hover:opacity-80 @max-[320px]:h-2 @max-[320px]:w-2 @max-[320px]:rounded-full @max-[320px]:overflow-hidden @max-[320px]:p-0',
        done && 'opacity-60',
      )}
      onClick={() => onOpen(item)}
      style={eventColorStyle(todoCalendarColor(item))}
      title={`${course} · ${item.title}${time ? ` · ${time}` : ''}`}
    >
      {time ? (
        <span className="shrink-0 tabular-nums opacity-70 @max-[520px]:hidden">{time}</span>
      ) : null}
      <span className={cn('truncate font-medium', done && 'line-through')}>{item.title}</span>
    </button>
  );
}

function DayOverflow({
  date,
  items,
  onOpen,
}: {
  date: Date;
  items: readonly TodoItem[];
  onOpen: (item: TodoItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="flex h-5 items-center rounded-chip px-1.5 text-left text-2xs text-ink-3 outline-none transition-colors duration-100 hover:bg-hover-2 hover:text-ink focus-visible:ring-[3px] focus-visible:ring-bui-accent-tint">
        +{items.length - 3}
        <span className="@max-[320px]:hidden"> 更多</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          className={cn(
            menuPanel,
            'max-h-(--radix-popover-content-available-height) w-60 origin-(--radix-popover-content-transform-origin)',
          )}
          sideOffset={4}
        >
          <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-3">{formatMonthDay(date)}</p>
          <ul className="grid gap-0.5 p-1">
            {items.map((item) => {
              const done = todoCompleted(item.status);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full min-w-0 items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-opacity hover:opacity-80',
                      done && 'opacity-60',
                    )}
                    onClick={() => {
                      setOpen(false);
                      onOpen(item);
                    }}
                    style={eventColorStyle(todoCalendarColor(item))}
                  >
                    <span className="shrink-0 tabular-nums opacity-70">
                      {item.dueAt ? formatTime(new Date(item.dueAt)) : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn('block truncate font-medium', done && 'line-through')}
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-2xs opacity-70">
                        {item.courseName ?? '个人待办'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** TODO 月历网格：只消费待办数据，月份导航由 TodoView 的页头提供。 */
export function TodoCalendar({
  items,
  month,
  onOpenItem,
}: {
  items: readonly TodoItem[];
  month: Date;
  onOpenItem: (item: TodoItem) => void;
}) {
  const grouped = groupTodosByDay(items);
  const days = monthGridDays(month);
  const todayKey = dateKey(new Date());

  return (
    <section aria-label="待办日历" className="@container">
      <div className="grid grid-cols-7 border-b">
        {weekDays.map((day) => (
          <div className="px-2 py-2 text-center text-2xs text-ink-3 @max-[320px]:px-1" key={day}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => {
          const key = dateKey(date);
          const dayItems = grouped.get(key) ?? [];
          const currentMonth =
            date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear();
          const today = key === todayKey;
          return (
            <div
              aria-label={`${date.getMonth() + 1}月${date.getDate()}日${
                dayItems.length ? `，${dayItems.length} 个待办` : ''
              }`}
              className={cn(
                'flex min-h-24 flex-col border-b border-line p-1.5 text-left @max-[320px]:min-h-16 @max-[320px]:p-1',
                !currentMonth && 'bg-inset text-ink-3',
              )}
              key={key}
            >
              <span
                className={cn(
                  'mb-1 grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium',
                  today && 'bg-ink text-surface',
                )}
              >
                {date.getDate()}
              </span>
              <span className="grid min-w-0 gap-0.5">
                {dayItems.slice(0, 3).map((item) => (
                  <TodoChip item={item} key={item.id} onOpen={onOpenItem} />
                ))}
                {dayItems.length > 3 ? (
                  <DayOverflow date={date} items={dayItems} onOpen={onOpenItem} />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
