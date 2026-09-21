import { describe, expect, it } from 'vitest';
import { canvasTodoStatus, todoCompleted } from './todo';

describe('Canvas 作业完成事实', () => {
  it('缺少提交数据不猜测未完成', () => {
    expect(canvasTodoStatus({})).toBe('unknown');
    expect(todoCompleted('unknown')).toBe(false);
  });
  it('有成绩或零分不等于已提交', () => {
    expect(
      canvasTodoStatus({ submission: { workflow_state: 'graded', score: 0, submitted_at: null } }),
    ).toBe('pending');
  });
  it('已提交、待批阅与已批改分别展示', () => {
    expect(canvasTodoStatus({ submission: { workflow_state: 'submitted' } })).toBe('submitted');
    expect(canvasTodoStatus({ submission: { workflow_state: 'pending_review' } })).toBe(
      'submitted',
    );
    expect(
      canvasTodoStatus({
        submission: { workflow_state: 'graded', submitted_at: '2026-09-21T00:00:00Z' },
      }),
    ).toBe('graded');
  });
  it('教师要求重交时不能继续显示完成', () => {
    const status = canvasTodoStatus({
      submission: { redo_request: true, submitted_at: '2026-09-21T00:00:00Z' },
    });
    expect(status).toBe('resubmit');
    expect(todoCompleted(status)).toBe(false);
  });
  it('豁免与线下作业独立展示', () => {
    expect(canvasTodoStatus({ submission: { excused: true } })).toBe('excused');
    expect(
      canvasTodoStatus({
        submission_types: ['on_paper'],
        submission: { workflow_state: 'unsubmitted' },
      }),
    ).toBe('offline');
  });
});
