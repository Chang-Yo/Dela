import { describe, expect, it } from 'vitest';
import { inferSemesterStart, semesterWindow, type SemesterRecording } from './semester-start';

const recording = (courseId: number, courseName: string, start: string): SemesterRecording => ({
  courseId,
  courseName,
  start,
});

describe('semesterWindow', () => {
  it('widens each term around the usual SJTU calendar', () => {
    expect(semesterWindow('2026-2027-1')).toEqual({ start: '2026-08-01', end: '2027-02-28' });
    expect(semesterWindow('2025-2026-2')).toEqual({ start: '2026-01-01', end: '2026-08-31' });
    expect(semesterWindow('2025-2026-3')).toEqual({ start: '2026-05-01', end: '2026-10-31' });
  });

  it('rejects unknown semester labels', () => {
    expect(semesterWindow('2026-2027-4')).toBeNull();
  });
});

describe('inferSemesterStart', () => {
  it('takes the Monday of the earliest lesson as the start date', () => {
    const guess = inferSemesterStart('2026-2027-1', [
      recording(1, '中文课', '2026-09-14 11:50:20'),
      recording(1, '中文课', '2026-09-16 11:50:20'),
      recording(2, '物理', '2026-09-15 16:00:00'),
    ]);
    expect(guess.candidate).toBe('2026-09-14');
    expect(guess.firstTeachingDay).toBe('2026-09-14');
    expect(guess.confidence).toBe('high');
    expect(guess.agreement).toBe(2);
    expect(guess.evidence.map((item) => [item.courseName, item.firstDay, item.weekday])).toEqual([
      ['中文课', '2026-09-14', 1],
      ['物理', '2026-09-15', 2],
    ]);
    expect(guess.warnings).toEqual([]);
  });

  it('skips recordings outside the semester window', () => {
    const guess = inferSemesterStart('2026-2027-1', [
      recording(1, '旧课', '2026-03-02 08:00:00'),
      recording(2, '新课', '2026-09-14 08:00:00'),
    ]);
    expect(guess.candidate).toBe('2026-09-14');
    expect(guess.courses).toBe(1);
    expect(guess.warnings.join()).toContain('已忽略 1 段不在该学期窗口内的录像');
  });

  it('stays low confidence when only one course has recordings', () => {
    const guess = inferSemesterStart('2026-2027-1', [
      recording(7, '第二周才开课的课', '2026-09-21 10:00:00'),
    ]);
    expect(guess.candidate).toBe('2026-09-21');
    expect(guess.confidence).toBe('low');
    expect(guess.warnings.join()).toContain('如果它并非第 1 周开课，推断出的开学日期会偏晚');
  });

  it('reports when there is nothing to infer from', () => {
    const guess = inferSemesterStart('2026-2027-1', []);
    expect(guess.candidate).toBeNull();
    expect(guess.confidence).toBe('none');
    expect(guess.warnings).toEqual(['该学期没有任何课堂录像，无法据此推断开学日期']);
  });
});
