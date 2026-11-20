import {
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CircleCheckBig,
  ExternalLink,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { TodoItem } from '../contract';
import { todoCompleted, todoStatusLabels } from '../contract';
import { Button } from '../../../ui/button';
import { Card } from '../../../ui/card';
import { useRootFontSize } from '../../../ui/hooks/root-font-size';
import { sanitizeHtml } from '../../mail/view';
import { useFrameBodyHeight } from '../../../ui/hooks/use-frame-body-height';
import { cn } from '../../../ui/lib/cn';
import { TodoSheet } from './TodoSheet';
import { dateLabel } from './todo-format';

/** 作业描述经清洗后放入沙箱 iframe；高度随内容自适应，滚动交给所在限高滚动区。 */
function CanvasHtml({ html, onLink }: { html: string; onLink: (url: string) => void }) {
  const rootSize = useRootFontSize();
  const doc = sanitizeHtml(html, 'https://oc.sjtu.edu.cn', rootSize);
  const [height, setBody] = useFrameBodyHeight();
  return (
    <Card>
      <iframe
        title="作业描述"
        className="w-full border-0 bg-paper"
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin"
        srcDoc={doc}
        style={{ height }}
        onLoad={(event) => {
          const frame = event.currentTarget;
          setBody(frame.contentDocument?.body ?? null);
          frame.contentDocument?.addEventListener('click', (e) => {
            const target = (e.target as Element).closest?.('a[href]');
            if (target) {
              e.preventDefault();
              onLink(target.getAttribute('href')!);
            }
          });
        }}
      />
    </Card>
  );
}

export function TodoDetail({
  item,
  now,
  onClose,
  onEdit,
  onDelete,
  onOpenLink,
}: {
  item: TodoItem;
  now: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenLink: (url: string) => void;
}) {
  const personal = item.source === 'personal';
  const done = todoCompleted(item.status);
  const overdue = !done && item.dueAt && Date.parse(item.dueAt) < now;
  return (
    <TodoSheet fixedHeight title={item.title} onClose={onClose}>
      <div className="mt-3 shrink-0 space-y-1.5 text-sm text-ink-3">
        <p className="flex items-start gap-1.5">
          <BookOpen className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">
            {item.courseName ?? '个人待办'} · {todoStatusLabels[item.status]}
          </span>
        </p>
        <p className={cn('flex items-center gap-1.5', overdue && 'text-danger')}>
          <CalendarClock className="size-3.5 shrink-0" />
          截止：{dateLabel(item.dueAt)}
        </p>
        {item.submittedAt && (
          <p className="flex items-center gap-1.5">
            <CircleCheckBig className="size-3.5 shrink-0" />
            提交于：{dateLabel(item.submittedAt)}
          </p>
        )}
        {personal && item.calendar && (
          <p className="flex items-center gap-1.5">
            <CalendarCheck className="size-3.5 shrink-0" />
            已写入日历
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
          <CanvasHtml html={item.description ?? ''} onLink={onOpenLink} />
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
                <ExternalLink className="size-4" />在 Canvas 中打开
              </Button>
            )
          )}
        </div>
      )}
    </TodoSheet>
  );
}
