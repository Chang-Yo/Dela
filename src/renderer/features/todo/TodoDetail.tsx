import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CircleCheckBig,
  ExternalLink,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { TodoItem } from '../../../shared/api';
import { todoCompleted, todoStatusLabels } from '../../../shared/todo';
import { Button } from '../../components/ui/button';
import { sanitizeHtml } from '../../lib/sanitize-html';
import { cn } from '../../lib/utils';
import { TodoSheet } from './TodoSheet';
import { dateLabel } from './todo-format';

/** 未量到真实高度前的初始描述高度(px)，与邮件正文一致。 */
const INITIAL_BODY_HEIGHT = 240;

/**
 * 作业描述经清洗后放入沙箱 iframe 渲染。阅读器默认样式禁止文档纵向滚动，
 * 因此高度随内容自适应（body 上挂 ResizeObserver 量高），滚动交给所在限高滚动区；
 * 链接点击转交外部打开。
 */
function CanvasHtml({ html, onLink }: { html: string; onLink: (url: string) => void }) {
  const doc = useMemo(() => sanitizeHtml(html, 'https://oc.sjtu.edu.cn'), [html]);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(INITIAL_BODY_HEIGHT);
  useEffect(() => {
    if (!body) return;
    const update = () => setHeight(body.scrollHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [body]);
  return (
    <iframe
      title="作业描述"
      className="w-full border-0 bg-white"
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
  );
}

/** 点击待办卡片滑出的详情：标题、元信息（课程·状态/截止/提交）、描述与操作。 */
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
    <TodoSheet fixedHeight label="待办详情" title={item.title} onClose={onClose}>
      <div className="mt-3 shrink-0 space-y-1.5 text-sm text-muted-foreground">
        <p className="flex items-start gap-1.5">
          <BookOpen className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">
            {item.courseName ?? '个人待办'} · {todoStatusLabels[item.status]}
          </span>
        </p>
        <p className={cn('flex items-center gap-1.5', overdue && 'text-destructive')}>
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
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words border-t pt-3 text-sm">
            {item.notes}
          </div>
        )
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t pt-3">
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
