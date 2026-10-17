import { describe, expect, it } from 'vitest';
import { compareCanvasTerms, latestTermOf } from './canvas';

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

  it('preserves the order of standard unprefixed academic terms', () => {
    const terms = ['2024-2025 Fall', '2025-2026 Fall', '2024-2025 Spring', '2025-2026 Spring'];
    expect(terms.sort(compareCanvasTerms)).toEqual([
      '2025-2026 Spring',
      '2025-2026 Fall',
      '2024-2025 Spring',
      '2024-2025 Fall',
    ]);
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

  it('uses the existing text tie-breaker for distinct names in the same period', () => {
    const terms = ['2024-2025 Summer', 'Michigan_2024-2025 Summer'];
    const sorted = [...terms].sort((a, b) => b.localeCompare(a));
    expect([...terms].sort(compareCanvasTerms)).toEqual(sorted);
    expect(latestTermOf(terms.map((term) => ({ term })))).toBe(sorted[0]);
  });

  it.each(['2027-2026 Fall', '2025-2027 Spring', '2026-2027', '2026-2027 Project'])(
    'does not invent a date for an invalid or incomplete term: %s',
    (term) => {
      expect([term, '2024-2025 Fall'].sort(compareCanvasTerms)).toEqual(['2024-2025 Fall', term]);
    },
  );

  it('preserves empty, unlabeled-only and undated-only latest-term behavior', () => {
    expect(latestTermOf([])).toBeUndefined();
    expect(latestTermOf([{ term: '未标注学期' }])).toBeUndefined();
    expect(latestTermOf([{ term: '默认学期' }])).toBe('默认学期');
  });
});
