import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from './parser';
import { measureEntries } from './evaluation';

it('replays the actual browser DOM against unchanged independent labels', async () => {
  const root = 'experiments/notice-subscriptions/benchmark/';
  const original = JSON.parse(await readFile(root + 'confirmation.json', 'utf8'));
  const rendered = JSON.parse(await readFile(root + 'rendered-regression.json', 'utf8'));
  const source = rendered.cases[0];
  expect(source.expected).toEqual(
    original.cases.find((item: { id: string }) => item.id === 'ocean').expected,
  );
  const html = gunzipSync(await readFile(root + source.snapshot));
  expect(createHash('sha256').update(html).digest('hex')).toBe(source.sha256);
  const candidate = analyzeNoticePage(html, source.finalUrl).candidates[0]!;
  expect(measureEntries(candidate.entries, source.expected).pass).toBe(true);
  expect(candidate.entries).toHaveLength(source.expected.length);
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});
