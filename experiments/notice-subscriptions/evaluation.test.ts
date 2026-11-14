import { expect, it } from 'vitest';
import { entryKey, measureCandidates, measureEntries } from './evaluation';
import type { NoticeCandidate, NoticeEntry } from './parser';

const item = (
  id: number,
  title = `学院公告 ${id}`,
  date: string | null = '2026-11-11',
): NoticeEntry => ({ id: String(id), title, url: `https://example.test/${id}`, publishedAt: date });
const candidate = (entries: NoticeEntry[]): NoticeCandidate => ({
  label: '列表',
  score: 50,
  reasons: [],
  entries,
  rule: { version: 1, kind: 'feed', pageUrl: 'https://example.test/', label: '列表' },
});

it('counts exact title/link matches, duplicates, extra items, missing entries and dates separately', () => {
  const result = measureEntries([item(1), item(1), item(3)], [item(1), item(2)]);
  expect(result).toMatchObject({
    predicted: 2,
    expected: 2,
    correct: 1,
    precision: 0.5,
    recall: 0.5,
    pass: false,
    dateExpected: 2,
    dateMatched: 1,
    dateCorrect: 1,
  });
  expect(result.missing.map((entry) => entry.url)).toEqual(['https://example.test/2']);
});

it('does not count a correct URL with the wrong title as a correct entry or invent date accuracy', () => {
  expect(measureEntries([item(1, '错误标题')], [item(1)]).correct).toBe(0);
  expect(measureEntries([item(1, undefined, null)], [item(1)])).toMatchObject({
    correct: 1,
    dateCorrect: 0,
    dateMatched: 1,
  });
});

it('distinguishes the first prediction from an oracle-selected candidate', () => {
  const result = measureCandidates(
    [candidate([item(3)]), candidate([item(1), item(2)])],
    [item(1), item(2)],
  );
  expect(result.first?.pass).toBe(false);
  expect(result.best).toMatchObject({ index: 2, pass: true });
  expect(measureCandidates([], [item(1)]).best).toBeNull();
});

it('normalizes decorative bullets and fragments but preserves title and article query identities', () => {
  expect(entryKey(item(1, '· 学院公告 1'))).toBe(entryKey(item(1)));
  expect(entryKey({ title: '标题', url: 'https://example.test/?id=1' })).not.toBe(
    entryKey({ title: '标题', url: 'https://example.test/?id=2' }),
  );
});
