import type { NoticeCandidate, NoticeEntry } from './parser';

export function entryKey(entry: Pick<NoticeEntry, 'title' | 'url'>): string {
  const url = new URL(entry.url);
  url.hash = '';
  const title = entry.title
    .replace(/\s+/g, ' ')
    .replace(/^[·•●]\s*/, '')
    .trim();
  return `${url.href}\n${title}`;
}

export function measureEntries(predicted: NoticeEntry[], expected: Omit<NoticeEntry, 'id'>[]) {
  const actual = new Map(predicted.map((entry) => [entryKey(entry), entry]));
  const truth = new Map(expected.map((entry) => [entryKey(entry), entry]));
  const matched = [...truth.entries()].filter(([key]) => actual.has(key));
  const dated = matched.filter(([, entry]) => entry.publishedAt !== null);
  const correctDates = dated.filter(
    ([key, entry]) =>
      actual.get(key)!.publishedAt?.slice(0, 10) === entry.publishedAt!.slice(0, 10),
  ).length;
  const precision = actual.size ? matched.length / actual.size : 0;
  const recall = truth.size ? matched.length / truth.size : 0;
  return {
    predicted: actual.size,
    expected: truth.size,
    correct: matched.length,
    precision,
    recall,
    pass: truth.size > 0 && precision >= 0.95 && recall >= 0.9,
    dateExpected: [...truth.values()].filter((entry) => entry.publishedAt !== null).length,
    dateMatched: dated.length,
    dateCorrect: correctDates,
    missing: [...truth.entries()].filter(([key]) => !actual.has(key)).map(([, entry]) => entry),
    unexpected: [...actual.entries()].filter(([key]) => !truth.has(key)).map(([, entry]) => entry),
  };
}

export function measureCandidates(
  candidates: NoticeCandidate[],
  expected: Omit<NoticeEntry, 'id'>[],
) {
  const measured = candidates.map((candidate, index) => ({
    index: index + 1,
    label: candidate.label,
    ...measureEntries(candidate.entries, expected),
  }));
  const ranked = [...measured].sort(
    (a, b) => Number(b.pass) - Number(a.pass) || b.correct - a.correct || b.precision - a.precision,
  );
  return { count: candidates.length, first: measured[0] ?? null, best: ranked[0] ?? null };
}
