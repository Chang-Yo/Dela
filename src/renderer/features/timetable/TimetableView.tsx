import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/PageHeader';
import { cn } from '../../lib/utils';

const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const timeSlots = ['08:00', '10:00', '13:00', '15:00', '19:00'];

type LessonTone = 'amber' | 'green' | 'blue';

const sampleLessons: Array<{
  name: string;
  room: string;
  day: number;
  slot: number;
  tone: LessonTone;
}> = [
  { name: '机器学习', room: '东上院 403', day: 1, slot: 2, tone: 'amber' },
  { name: '计算机网络', room: '电院 3-104', day: 2, slot: 1, tone: 'green' },
  { name: '人工智能', room: '包玉刚图书馆', day: 4, slot: 2, tone: 'blue' },
  { name: '体育', room: '光明体育场', day: 5, slot: 4, tone: 'green' },
];

const lessonTone: Record<LessonTone, string> = {
  amber: 'bg-amber-500/15 dark:bg-amber-400/15',
  green: 'bg-emerald-500/15 dark:bg-emerald-400/15',
  blue: 'bg-sky-500/15 dark:bg-sky-400/15',
};

export function TimetableView() {
  return (
    <div className="page">
      <PageHeader
        actions={
          <Button size="sm" variant="secondary">
            <RefreshCw className="size-3.5" />
            同步
          </Button>
        }
        eyebrow="校园日程"
        title="课表"
      />
      <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">预览</span>
        课表数据尚未接入校园接口，以下为界面示例。
      </div>
      <section aria-label="周课表" className="mt-5 overflow-x-auto">
        <div className="grid min-w-[780px] grid-cols-[64px_repeat(7,minmax(96px,1fr))] overflow-hidden rounded-xl border bg-card">
          <div className="border-b border-r bg-muted/60 p-3 text-center text-xs font-semibold text-muted-foreground" />
          {weekDays.map((day) => (
            <div
              className="border-b bg-muted/60 p-3 text-center text-xs font-semibold text-muted-foreground"
              key={day}
            >
              {day}
            </div>
          ))}
          {timeSlots.map((slot, slotIndex) => (
            <div className="grid grid-cols-subgrid col-span-full" key={slot}>
              <div
                className={cn(
                  'grid place-items-center border-r p-2 text-xs text-muted-foreground',
                  slotIndex > 0 && 'border-t',
                )}
              >
                {slot}
              </div>
              {weekDays.map((day, dayIndex) => {
                const lesson = sampleLessons.find(
                  (item) => item.day === dayIndex + 1 && item.slot === slotIndex + 1,
                );
                return (
                  <div className={cn('min-h-[84px] p-1', slotIndex > 0 && 'border-t')} key={day}>
                    {lesson && (
                      <div
                        className={cn(
                          'grid h-full gap-0.5 rounded-lg p-2 text-xs',
                          lessonTone[lesson.tone],
                        )}
                      >
                        <strong className="text-sm">{lesson.name}</strong>
                        <span className="text-muted-foreground">{lesson.room}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
