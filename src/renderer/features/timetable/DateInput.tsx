import { Fragment, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../../lib/utils';

type DateSegments = { year: string; month: string; day: string };

const fields = [
  { key: 'year', maxLength: 4, placeholder: '2026', suffix: '年', width: 'w-11' },
  { key: 'month', maxLength: 2, placeholder: '09', suffix: '月', width: 'w-6' },
  { key: 'day', maxLength: 2, placeholder: '14', suffix: '日', width: 'w-6' },
] as const;

function splitDate(value: string): DateSegments {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) return { year: '', month: '', day: '' };
  return { year: matched[1]!, month: matched[2]!, day: matched[3]! };
}

function daysInMonth(year: number, month: number): number {
  // day 传 0 得到该月最后一天。
  return new Date(year, month, 0).getDate();
}

// 三段都填满且构成真实日期才输出 "YYYY-MM-DD"，否则空串（由调用方在提交时报错）。
function joinedValue({ day, month, year }: DateSegments): string {
  if (year.length !== 4 || month.length !== 2 || day.length !== 2) return '';
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12) return '';
  if (dayNumber < 1 || dayNumber > daysInMonth(Number(year), monthNumber)) return '';
  return `${year}-${month}-${day}`;
}

export function DateInput({
  autoFocus = false,
  className,
  label,
  onChange,
  value,
}: {
  autoFocus?: boolean;
  className?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [segments, setSegments] = useState(() => splitDate(value));
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // 本组件 emit 的值永远等于当前内部分段的拼合结果；两者不一致只可能是父组件
  // 在外部重置了 value，此时把内部分段同步回去（内容相同则不再 setState，避免死循环）。
  if (value !== joinedValue(segments)) {
    const next = splitDate(value);
    if (next.year !== segments.year || next.month !== segments.month || next.day !== segments.day) {
      setSegments(next);
    }
  }

  const focusSegment = (index: number) => {
    inputsRef.current[index]?.focus();
  };

  const handleSegmentChange = (index: number, raw: string) => {
    const field = fields[index]!;
    // 只在 onChange 里过滤非数字并裁剪长度，不用 keydown 操纵值，保证 IME 安全。
    const digits = raw.replace(/\D/g, '').slice(0, field.maxLength);
    const next: DateSegments = { ...segments, [field.key]: digits };
    setSegments(next);
    onChange(joinedValue(next));
    if (digits.length === field.maxLength && index < fields.length - 1) {
      focusSegment(index + 1);
    }
  };

  const handleSegmentKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    // 输入法组合期间不动焦点，避免打断选字。
    if (event.nativeEvent.isComposing) return;
    const input = event.currentTarget;
    if (event.key === 'Backspace' && input.value === '' && index > 0) {
      event.preventDefault();
      focusSegment(index - 1);
    } else if (event.key === 'ArrowLeft' && input.selectionStart === 0 && index > 0) {
      event.preventDefault();
      focusSegment(index - 1);
    } else if (
      event.key === 'ArrowRight' &&
      input.selectionStart === input.value.length &&
      index < fields.length - 1
    ) {
      event.preventDefault();
      focusSegment(index + 1);
    }
  };

  return (
    <div
      aria-label={label}
      className={cn('flex items-center gap-1 text-13 tabular-nums', className)}
      data-slot="date-input"
      role="group"
    >
      {fields.map((field, index) => (
        <Fragment key={field.key}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-ink-3">
              /
            </span>
          ) : null}
          <input
            aria-label={field.suffix}
            autoFocus={autoFocus && index === 0}
            className={cn(
              'bg-transparent text-center outline-none placeholder:text-ink-3',
              field.width,
            )}
            inputMode="numeric"
            maxLength={field.maxLength}
            onChange={(event) => handleSegmentChange(index, event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => handleSegmentKeyDown(index, event)}
            placeholder={field.placeholder}
            ref={(element) => {
              inputsRef.current[index] = element;
            }}
            value={segments[field.key]}
          />
        </Fragment>
      ))}
    </div>
  );
}
