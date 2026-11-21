import { describe, expect, it } from 'vitest';
import { canvasTodoStatus } from '../todo-source';

describe('Canvas 作业完成事实', () => {
  it('缺少提交数据不猜测未完成', () => {
    expect(canvasTodoStatus({}).status).toBe('unknown');
  });
  it('有成绩或零分不等于已提交', () => {
    expect(
      canvasTodoStatus({ submission: { workflow_state: 'graded', score: 0, submitted_at: null } }),
    ).toEqual({ status: 'open', statusLabel: '未完成' });
  });
  it('已提交、待批阅与已批改都算完成，说法各自保留', () => {
    expect(canvasTodoStatus({ submission: { workflow_state: 'submitted' } })).toEqual({
      status: 'done',
      statusLabel: '已提交',
    });
    expect(canvasTodoStatus({ submission: { workflow_state: 'pending_review' } }).status).toBe(
      'done',
    );
    expect(
      canvasTodoStatus({
        submission: { workflow_state: 'graded', submitted_at: '2026-09-21T00:00:00Z' },
      }),
    ).toEqual({ status: 'done', statusLabel: '已批改' });
  });
  it('教师要求重交时不能继续显示完成', () => {
    expect(
      canvasTodoStatus({
        submission: { redo_request: true, submitted_at: '2026-09-21T00:00:00Z' },
      }),
    ).toEqual({ status: 'open', statusLabel: '需重新提交' });
  });
  it('豁免算完成，线下作业不猜测', () => {
    expect(canvasTodoStatus({ submission: { excused: true } }).status).toBe('done');
    expect(
      canvasTodoStatus({
        submission_types: ['on_paper'],
        submission: { workflow_state: 'unsubmitted' },
      }),
    ).toEqual({ status: 'unknown', statusLabel: '线下 / 无需在线提交' });
  });
});
