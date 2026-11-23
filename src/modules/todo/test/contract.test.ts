import { describe, expect, it } from 'vitest';
import { todoInRange } from '../contract';

const today = new Date(2026, 10, 23).toISOString();
const tomorrow = new Date(2026, 10, 24).toISOString();

describe('todoInRange', () => {
  it('昨天的全天与时段不算进今天', () => {
    expect(
      todoInRange(
        { kind: 'allDay', startDate: '2026-11-22', endDate: '2026-11-22' },
        today,
        tomorrow,
      ),
    ).toBe(false);
    const evening = {
      kind: 'span',
      start: new Date(2026, 10, 22, 23).toISOString(),
      end: today,
    } as const;
    expect(todoInRange(evening, today, tomorrow)).toBe(false);
  });

  it('今天的全天与恰在零点截止的条目都算进今天', () => {
    expect(
      todoInRange(
        { kind: 'allDay', startDate: '2026-11-23', endDate: '2026-11-23' },
        today,
        tomorrow,
      ),
    ).toBe(true);
    expect(todoInRange({ kind: 'due', at: today }, today, tomorrow)).toBe(true);
    expect(todoInRange({ kind: 'due', at: tomorrow }, today, tomorrow)).toBe(false);
  });
});
