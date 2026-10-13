import { useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  CalendarRange,
  CircleCheckBig,
  Clock,
  GraduationCap,
  MapPin,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { CalendarEvent } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import {
  calendarToneKey,
  colorFor,
  formatEventRange,
  formatMinuteOfDay,
  formatMonthDay,
  periodBoundary,
  weekdayName,
} from './timetable-format';
import type { CalendarItemDetail } from './WeekCalendar';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { cn } from '../../lib/utils';

// 点击周视图条目后的详情弹窗：排版参考 Google Calendar 的事件卡
// （色点标题 + 小图标信息行）。课程只读；自建事件的删除需二次确认；
// 待办派生事件不可删，提供跳转 TODO 的入口。
export function EventDetailDialog({
  detail,
  onClose,
  onDeleted,
  onOpenTodo,
}: {
  detail: CalendarItemDetail;
  onClose: () => void;
  onDeleted: () => void;
  onOpenTodo?: (todoId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deleteEvent = async (event: CalendarEvent) => {
    // 待办派生事件的删除只能发生在 TODO 视图；此入口只接受数字 id 的自建事件。
    if (typeof event.id !== 'number') return;
    setDeleting(true);
    try {
      await window.dela!.timetable.deleteEvent(event.id);
      onDeleted();
    } catch (reason) {
      setDeleting(false);
      setConfirming(false);
      showToast({ variant: 'error', title: '删除事件失败', description: errorText(reason) });
    }
  };

  const tone =
    detail.kind === 'lesson'
      ? colorFor(detail.lesson.courseCode || detail.lesson.courseName)
      : calendarToneKey(detail.event.color);

  let timeText;
  if (detail.kind === 'lesson') {
    const start = periodBoundary(detail.lesson.startPeriod, 'start');
    const end = periodBoundary(detail.lesson.endPeriod, 'end');
    timeText = detail.date
      ? `${formatMonthDay(detail.date)}（${weekdayName(detail.date)}）${formatMinuteOfDay(start)} – ${formatMinuteOfDay(end)}`
      : `${formatMinuteOfDay(start)} – ${formatMinuteOfDay(end)}`;
  } else {
    timeText = formatEventRange(detail.event);
  }

  return (
    <DialogPrimitive.Root onOpenChange={(open) => !open && !deleting && onClose()} open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlay} />
        <DialogPrimitive.Content
          className={cn(
            dialogPanel,
            'max-h-[calc(100dvh-2rem)] w-[400px] max-w-[calc(100vw-2rem)] overflow-y-auto p-5',
          )}
        >
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1 size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--cal-${tone}-bg)` }}
            />
            <DialogPrimitive.Title className="min-w-0 flex-1 break-words text-base font-semibold leading-snug tracking-tight">
              {detail.kind === 'lesson' ? detail.lesson.courseName : detail.event.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button aria-label="关闭" className="-mr-2 -mt-1" size="icon-sm" variant="ghost">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {detail.kind === 'lesson' && (detail.lesson.className || detail.lesson.courseCode) ? (
            <DialogPrimitive.Description className="mt-1 pl-5 text-[12px] text-ink-3">
              {[detail.lesson.className, detail.lesson.courseCode].filter(Boolean).join(' · ')}
            </DialogPrimitive.Description>
          ) : null}
          <div className="mt-4 grid gap-2.5 pl-5 text-[13px]">
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span className="tabular-nums">{timeText}</span>
            </div>
            {detail.kind === 'todo' ? (
              <div className="flex items-start gap-2">
                <CircleCheckBig className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span>来自个人待办的截止时间</span>
              </div>
            ) : null}
            {detail.kind !== 'lesson' ? (
              detail.event.location ? (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <span className="break-words">{detail.event.location}</span>
                </div>
              ) : null
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <span className="break-words">
                    {[detail.lesson.classroom, detail.lesson.campus].filter(Boolean).join(' · ') ||
                      '地点未定'}
                  </span>
                </div>
                {detail.lesson.teacher ? (
                  <div className="flex items-start gap-2">
                    <User className="mt-0.5 size-4 shrink-0 text-ink-3" />
                    <span className="break-words">{detail.lesson.teacher}</span>
                  </div>
                ) : null}
                <div className="flex items-start gap-2">
                  <CalendarRange className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <span>{detail.lesson.weeksText}</span>
                </div>
                {detail.lesson.credits != null ? (
                  <div className="flex items-start gap-2">
                    <GraduationCap className="mt-0.5 size-4 shrink-0 text-ink-3" />
                    <span>{detail.lesson.credits} 学分</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
          {/* 底部只保留破坏性操作的确认区；关闭走右上角 X，避免重复入口。 */}
          {detail.kind === 'event' ? (
            <div className="mt-5 flex items-center gap-1.5">
              {confirming ? (
                <>
                  <span className="text-[12px] text-ink-3">确认删除？</span>
                  <Button
                    disabled={deleting}
                    onClick={() => void deleteEvent(detail.event)}
                    size="sm"
                    variant="destructive"
                  >
                    删除
                  </Button>
                  <Button
                    disabled={deleting}
                    onClick={() => setConfirming(false)}
                    size="sm"
                    variant="ghost"
                  >
                    取消
                  </Button>
                </>
              ) : (
                <Button
                  className="text-red hover:text-red"
                  onClick={() => setConfirming(true)}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              )}
            </div>
          ) : null}
          {detail.kind === 'todo' && detail.event.todoId && onOpenTodo ? (
            <div className="mt-5 flex items-center">
              <Button
                onClick={() => {
                  onOpenTodo(detail.event.todoId!);
                  onClose();
                }}
                size="sm"
                variant="outline"
              >
                <CircleCheckBig className="size-3.5" />在 TODO 中查看
              </Button>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
