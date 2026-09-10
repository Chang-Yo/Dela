import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import styles from './TimetableView.module.css';

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

export function TimetableView() {
  return (
    <div className="page">
      <PageHeader
        actions={
          <Button className={styles.headerPrimary} variant="primary">
            ↻ 同步
          </Button>
        }
        eyebrow="校园日程"
        title="课表"
      />
      <div className={styles.previewNote}>
        <span>预览</span>课表数据尚未接入校园接口，以下为界面示例。
      </div>
      <section aria-label="周课表" className={styles.gridScroller}>
        <div className={styles.weekGrid}>
          <div className={styles.cornerCell} />
          {weekDays.map((day) => (
            <div className={styles.dayHeader} key={day}>
              {day}
            </div>
          ))}
          {timeSlots.map((slot, slotIndex) => (
            <div className={styles.slotRow} key={slot}>
              <div className={styles.slotLabel}>{slot}</div>
              {weekDays.map((day, dayIndex) => {
                const lesson = sampleLessons.find(
                  (item) => item.day === dayIndex + 1 && item.slot === slotIndex + 1,
                );
                return (
                  <div className={styles.slotCell} key={day}>
                    {lesson && (
                      <div className={`${styles.lesson} ${styles[lesson.tone]}`}>
                        <strong>{lesson.name}</strong>
                        <span>{lesson.room}</span>
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
