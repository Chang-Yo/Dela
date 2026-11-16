'use client';

import { Bot, Layers, Square, SquareTerminal } from 'lucide-react';
import { cn } from '../cn';
import { IconButton } from '../icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { useNow } from '../use-now';

export type BackgroundTaskItem = {
  id: string;
  kind: 'bash' | 'subagent';
  label: string;
  startedAt: number;
};

type BackgroundTaskActions = {
  onStop: (taskId: string) => void;
  onOpenSubagent: (taskId: string) => void;
  formatElapsed: (ms: number) => string;
};

export function BackgroundTasks({
  tasks,
  ...actions
}: { tasks: BackgroundTaskItem[] } & BackgroundTaskActions) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`后台任务（${tasks.length} 个运行中）`}
          className="flex h-7 shrink-0 items-center gap-1 rounded-control px-1.5 text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink"
          title="后台任务"
          type="button"
        >
          <Layers className="size-4" />
          <span className="text-xs tabular-nums">{tasks.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="后台任务" className="w-72" side="top">
        <BackgroundTaskList tasks={tasks} {...actions} />
      </PopoverContent>
    </Popover>
  );
}

function BackgroundTaskList({
  tasks,
  onStop,
  onOpenSubagent,
  formatElapsed,
}: { tasks: BackgroundTaskItem[] } & BackgroundTaskActions) {
  const now = useNow(1000);
  return (
    <ul className="grid grid-cols-1">
      {tasks.map((task) => {
        const Icon = task.kind === 'bash' ? SquareTerminal : Bot;
        const label = (
          <>
            <Icon className="size-3.5 shrink-0 text-ink-3" />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm text-ink',
                task.kind === 'bash' && 'font-mono',
              )}
              title={task.label}
            >
              {task.label}
            </span>
          </>
        );
        return (
          <li className="flex h-9 items-center gap-2 rounded-chip pl-2 pr-1" key={task.id}>
            {task.kind === 'subagent' ? (
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                onClick={() => onOpenSubagent(task.id)}
                title="打开子会话"
                type="button"
              >
                {label}
              </button>
            ) : (
              label
            )}
            <span className="shrink-0 text-xs tabular-nums text-ink-3">
              {formatElapsed(now - task.startedAt)}
            </span>
            <IconButton aria-label="停止" onClick={() => onStop(task.id)} title="停止">
              <Square />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}
