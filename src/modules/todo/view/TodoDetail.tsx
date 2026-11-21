import {
  BookOpen,
  CalendarClock,
  CircleCheckBig,
  ExternalLink,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { TodoItem } from '../contract';
import { todoOverdue, todoStatusLabel, todoTimeLabel } from '../contract';
import { Button } from '../../../ui/button';
import { Card } from '../../../ui/card';
import { HtmlFrame } from '../../../ui/html-frame';
import { cn } from '../../../ui/lib/cn';
import { TodoSheet } from './TodoSheet';
import { dateLabel } from './todo-format';

export function TodoDetail({
  item,
  now,
  onClose,
  onEdit,
  onDelete,
  onOpenLink,
  openLabel,
}: {
  item: TodoItem;
  now: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenLink: (url: string) => void;
  openLabel: string;
}) {
  const personal = item.source === 'personal';
  const overdue = todoOverdue(item, now);
  return (
    <TodoSheet fixedHeight title={item.title} onClose={onClose}>
      <div className="mt-3 shrink-0 space-y-1.5 text-sm text-ink-3">
        <p className="flex items-start gap-1.5">
          <BookOpen className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">
            {item.group?.label ?? '个人待办'} · {todoStatusLabel(item)}
          </span>
        </p>
        <p className={cn('flex items-center gap-1.5', overdue && 'text-danger')}>
          <CalendarClock className="size-3.5 shrink-0" />
          {todoTimeLabel(item.time)}
        </p>
        {item.completedAt && (
          <p className="flex items-center gap-1.5">
            <CircleCheckBig className="size-3.5 shrink-0" />
            完成于：{dateLabel(item.completedAt)}
          </p>
        )}
      </div>
      {personal ? (
        item.notes && (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words border-t pt-3 text-sm [scrollbar-width:none]">
            {item.notes}
          </div>
        )
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t pt-3 [scrollbar-width:none]">
          <Card>
            <HtmlFrame
              baseUrl={item.url}
              className="bg-paper"
              html={item.bodyHtml ?? ''}
              onLink={onOpenLink}
              title="正文"
            />
          </Card>
        </div>
      )}
      {(personal || item.url) && (
        <div className="mt-auto flex items-center justify-end gap-2 pt-4">
          {personal ? (
            <>
              <Button variant="ghost" onClick={onDelete}>
                <Trash2 className="size-4" />
                删除
              </Button>
              <Button onClick={onEdit}>
                <Pencil className="size-4" />
                编辑
              </Button>
            </>
          ) : (
            item.url && (
              <Button onClick={() => onOpenLink(item.url!)}>
                <ExternalLink className="size-4" />
                {openLabel}
              </Button>
            )
          )}
        </div>
      )}
    </TodoSheet>
  );
}
