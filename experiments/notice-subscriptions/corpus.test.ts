import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { analyzeNoticePage, extractNoticeEntries } from './parser';
import { measureCandidates } from './evaluation';

const root = resolve('experiments/notice-subscriptions/benchmark');
const sourceSchema = z.object({
  id: z.string(),
  url: z.url(),
  finalUrl: z.string().optional(),
  status: z.enum(['captured', 'fetch-failed']),
  snapshot: z.string().optional(),
  sha256: z.string().optional(),
  contentType: z.string().optional(),
  expected: z.array(
    z.object({
      title: z.string().min(1),
      url: z.url(),
      publishedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    }),
  ),
});
const sources = (name: string) =>
  z
    .object({ cases: z.array(sourceSchema) })
    .parse(JSON.parse(readFileSync(resolve(root, name + '.json'), 'utf8'))).cases;

it('preserves raw snapshots, annotations, split provenance and the archived baseline', () => {
  const seenHosts = new Set<string>();
  for (const split of ['development', 'holdout', 'confirmation']) {
    const cases = sources(split);
    expect(cases.length).toBe(split === 'confirmation' ? 4 : 6);
    for (const source of cases) {
      const host = new URL(source.url).hostname.replace(/^www\./, '');
      expect(seenHosts.has(host), source.id).toBe(false);
      seenHosts.add(host);
      if (source.status === 'fetch-failed') continue;
      const path = resolve(root, source.snapshot!);
      expect(path.startsWith(root + sep)).toBe(true);
      const bytes = gunzipSync(readFileSync(path));
      expect(createHash('sha256').update(bytes).digest('hex'), source.id).toBe(source.sha256);
      expect(new Set(source.expected.map((entry) => entry.url)).size, source.id).toBe(
        source.expected.length,
      );
      for (const entry of source.expected) {
        expect(['https:', 'http:']).toContain(new URL(entry.url).protocol);
        if (entry.publishedAt)
          expect(new Date(entry.publishedAt).toISOString().slice(0, 10), source.id).toBe(
            entry.publishedAt,
          );
      }
    }
  }
  const protocol = JSON.parse(readFileSync(resolve(root, 'protocol.json'), 'utf8'));
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'baseline-parser.ts.txt')))
      .digest('hex'),
  ).toBe(protocol.baselineParserSha256);
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'holdout.json')))
      .digest('hex'),
  ).toBe(protocol.sealedHoldoutManifestSha256);
});

it.each(sources('development').filter((source) => source.expected.length > 0))(
  'keeps the labeled development list and serialized rule for $id',
  (source) => {
    const bytes = gunzipSync(readFileSync(resolve(root, source.snapshot!)));
    const charset = /charset=([\w-]+)/i.exec(source.contentType ?? '')?.[1];
    const analysis = analyzeNoticePage(bytes, source.finalUrl ?? source.url, { charset });
    const measured = measureCandidates(analysis.candidates, source.expected);
    expect(measured.first?.pass, source.id).toBe(true);
    expect(measured.first?.dateCorrect).toBe(
      source.expected.filter((entry) => entry.publishedAt !== null).length,
    );
    const selected = analysis.candidates[0]!;
    expect(extractNoticeEntries(bytes, JSON.parse(JSON.stringify(selected.rule)), charset)).toEqual(
      selected.entries,
    );
  },
);
