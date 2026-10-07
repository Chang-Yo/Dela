import { StepperControl } from '../../components/ui/stepper';

type StepperField = 'year' | 'month' | 'day' | 'hour' | 'minute';

const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// 各字段步进后超出范围时靠 Date 进位（59 分 +1 → 下一小时）；月/年切换时把日收敛到
// 目标月份的真实天数（1月31日 +1 月得 2月28/29日），避免 JS 日期溢出到三月。
function step(date: Date, field: StepperField, delta: 1 | -1): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  if (field === 'minute') return new Date(year, month, day, hour, minute + delta);
  if (field === 'hour') return new Date(year, month, day, hour + delta, minute);
  if (field === 'day') return new Date(year, month, day + delta, hour, minute);
  if (field === 'month') {
    const next = new Date(year, month + delta, 1);
    return new Date(
      next.getFullYear(),
      next.getMonth(),
      Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())),
      hour,
      minute,
    );
  }
  if (year + delta < MIN_YEAR || year + delta > MAX_YEAR) return date;
  return new Date(
    year + delta,
    month,
    Math.min(day, daysInMonth(year + delta, month)),
    hour,
    minute,
  );
}

/** 年/月/日/时/分 五字段步进选择器：值左箭头减、右箭头增，按住可连发。 */
export function DateTimeStepper({
  label = '截止时间',
  value,
  onChange,
}: {
  label?: string;
  value: Date;
  onChange: (date: Date) => void;
}) {
  const pad = (input: number) => `${input}`.padStart(2, '0');
  const columns: { display: string; field: StepperField; label: string }[] = [
    { display: `${value.getFullYear()}年`, field: 'year', label: '年份' },
    { display: `${value.getMonth() + 1}月`, field: 'month', label: '月份' },
    { display: `${value.getDate()}日`, field: 'day', label: '日期' },
    { display: `${pad(value.getHours())}时`, field: 'hour', label: '小时' },
    { display: `${pad(value.getMinutes())}分`, field: 'minute', label: '分钟' },
  ];
  return (
    // flex-wrap：字体缩放或窄容器放不下五个字段时自动换行。
    <div
      aria-label={label}
      className="flex flex-wrap items-start justify-center gap-1"
      role="group"
    >
      {columns.map((column) => (
        <StepperControl
          display={column.display}
          key={column.field}
          label={column.label}
          onStep={(delta) => onChange(step(value, column.field, delta))}
        />
      ))}
    </div>
  );
}
