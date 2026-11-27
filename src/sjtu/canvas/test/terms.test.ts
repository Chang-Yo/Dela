import { describe, expect, it } from 'vitest';
import { compareCanvasTerms, groupCanvasCoursesByTerm, latestTermOf } from '../contract';

describe('Canvas term ordering', () => {
  it('sorts prefixed and standard academic terms chronologically without renaming them', () => {
    const terms = [
      'Michigan_2024-2025 Summer',
      '2026-2027 Fall',
      '2025-2026 Fall',
      'GC_2025-2026 Summer',
      '2025-2026 Spring',
      '2024-2025 Spring',
      '2024-2025 Fall',
    ];
    expect([...terms].sort(compareCanvasTerms)).toEqual([
      '2026-2027 Fall',
      'GC_2025-2026 Summer',
      '2025-2026 Spring',
      '2025-2026 Fall',
      'Michigan_2024-2025 Summer',
      '2024-2025 Spring',
      '2024-2025 Fall',
    ]);
    const courses = terms.map((term) => ({ term }));
    expect(latestTermOf(courses)).toBe('2026-2027 Fall');
    expect(courses.map(({ term }) => term)).toEqual(terms);
  });

  it('compares single calendar years with academic years using the actual season year', () => {
    expect(
      ['2025-2026 Summer', '2026 秋季', '2026-2027 Spring', '2026 春季'].sort(compareCanvasTerms),
    ).toEqual(['2026-2027 Spring', '2026 秋季', '2025-2026 Summer', '2026 春季']);
  });

  it('accepts Chinese seasons and case-insensitive English seasons', () => {
    expect(
      ['2025-2026学年秋季学期', 'GC_2025-2026 summer', '2025-2026学年春季学期'].sort(
        compareCanvasTerms,
      ),
    ).toEqual(['GC_2025-2026 summer', '2025-2026学年春季学期', '2025-2026学年秋季学期']);
  });

  it('puts unrecognized names after dated terms and keeps the existing text fallback', () => {
    const unknown = ['默认学期', '未标注学期', '长期课程'];
    expect([...unknown, '2026-2027 Fall'].sort(compareCanvasTerms)).toEqual([
      '2026-2027 Fall',
      ...[...unknown].sort((a, b) => b.localeCompare(a)),
    ]);
    expect(latestTermOf([...unknown, '2026-2027 Fall'].map((term) => ({ term })))).toBe(
      '2026-2027 Fall',
    );
  });

  it.each(['2027-2026 Fall', '2026-2027'])(
    'does not invent a date for an invalid or incomplete term: %s',
    (term) => {
      expect([term, '2024-2025 Fall'].sort(compareCanvasTerms)).toEqual(['2024-2025 Fall', term]);
    },
  );
});

describe('groupCanvasCoursesByTerm', () => {
  const course = (id: number, name: string, term: string) => ({
    id,
    name,
    term,
    code: '',
    syncedAt: null,
    error: null,
  });

  it('groups by term in descending term order and sorts courses by name within a group', () => {
    // 组内名字用 ASCII：localeCompare 的中文排序依赖 ICU 环境，测试只锁分组与排序机制。
    const courses = [
      course(3, 'Networks', '2026-2027 Fall'),
      course(1, '机器学习', '2025-2026 Spring'),
      course(2, 'Algorithms', '2026-2027 Fall'),
      course(4, '旧课', '2024-2025 Fall'),
    ];
    expect(groupCanvasCoursesByTerm(courses)).toEqual([
      {
        term: '2026-2027 Fall',
        courses: [
          course(2, 'Algorithms', '2026-2027 Fall'),
          course(3, 'Networks', '2026-2027 Fall'),
        ],
      },
      { term: '2025-2026 Spring', courses: [course(1, '机器学习', '2025-2026 Spring')] },
      { term: '2024-2025 Fall', courses: [course(4, '旧课', '2024-2025 Fall')] },
    ]);
  });
});
