import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import * as currentParser from './parser';
import { entryKey, measureCandidates } from './evaluation';

const corpusSchema = z.object({
  version: z.literal(1),
  split: z.string(),
  frozenAt: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      url: z.url(),
      finalUrl: z.string().optional(),
      status: z.enum(['captured', 'fetch-failed']),
      fetchedAt: z.string().optional(),
      contentType: z.string().optional(),
      sha256: z.string().optional(),
      snapshot: z.string().optional(),
      error: z.string().optional(),
      annotation: z
        .object({ notes: z.string(), targetAvailable: z.boolean().optional() })
        .passthrough()
        .optional(),
      expected: z.array(
        z.object({ title: z.string(), url: z.url(), publishedAt: z.string().nullable() }),
      ),
    }),
  ),
});

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, baseline: { type: 'string' } },
  });
  const path = positionals[0];
  if (!path)
    throw new Error('benchmark <manifest.json> [--baseline parser.ts] [--out result.json]');
  const bytes = await readFile(path);
  const corpus = corpusSchema.parse(JSON.parse(bytes.toString('utf8')));
  const parser: typeof currentParser = values.baseline
    ? await import(pathToFileURL(resolve(values.baseline)).href)
    : currentParser;
  const parserPath = values.baseline ?? 'experiments/notice-subscriptions/parser.ts';
  const parserSha256 = createHash('sha256')
    .update(await readFile(parserPath))
    .digest('hex');
  const cases = [];
  for (const source of corpus.cases) {
    if (source.status === 'fetch-failed') {
      cases.push({
        id: source.id,
        label: source.label,
        outcome: 'fetch-failed',
        error: source.error,
      });
      continue;
    }
    if (!source.snapshot || !source.sha256) throw new Error(`快照元数据缺失：${source.id}`);
    const html = gunzipSync(await readFile(resolve(dirname(path), source.snapshot)));
    if (createHash('sha256').update(html).digest('hex') !== source.sha256)
      throw new Error(`快照 SHA256 不匹配：${source.id}`);
    if (new Set(source.expected.map(entryKey)).size !== source.expected.length)
      throw new Error(`标注重复：${source.id}`);
    const url = source.finalUrl ?? source.url;
    const charset = /charset=([\w-]+)/i.exec(source.contentType ?? '')?.[1];
    const analysis = parser.analyzeNoticePage(html, url, { charset });
    if (!source.expected.length) {
      cases.push({
        id: source.id,
        label: source.label,
        outcome: 'target-not-on-page',
        candidates: analysis.candidates.length,
        diagnostics: analysis.diagnostics,
      });
      continue;
    }
    const automatic = measureCandidates(analysis.candidates, source.expected);
    const assistedAnalysis = parser.analyzeNoticePage(html, url, {
      charset,
      sampleTitle: source.expected[0]!.title,
    });
    const assisted = measureCandidates(assistedAnalysis.candidates, source.expected);
    let replay: boolean | null = null;
    let replayError: string | undefined;
    const selected = automatic.best ? analysis.candidates[automatic.best.index - 1] : undefined;
    if (selected) {
      try {
        const entries = parser.extractNoticeEntries(
          html,
          JSON.parse(JSON.stringify(selected.rule)),
          charset,
        );
        replay =
          JSON.stringify(entries.map(entryKey).sort()) ===
          JSON.stringify(selected.entries.map(entryKey).sort());
      } catch (error) {
        replay = false;
        replayError = error instanceof Error ? error.message : String(error);
      }
    }
    cases.push({
      id: source.id,
      label: source.label,
      outcome: 'evaluated',
      expected: source.expected.length,
      knownDates: source.expected.filter((entry) => entry.publishedAt !== null).length,
      automatic,
      assisted,
      replay,
      replayError,
      diagnostics: analysis.diagnostics,
    });
  }
  const evaluated = cases.filter((source) => source.outcome === 'evaluated');
  const summary = {
    total: cases.length,
    fetched: cases.filter((source) => source.outcome !== 'fetch-failed').length,
    labeled: evaluated.length,
    fetchFailed: cases.filter((source) => source.outcome === 'fetch-failed').length,
    targetNotOnPage: cases.filter((source) => source.outcome === 'target-not-on-page').length,
    firstPass: evaluated.filter((source) => source.automatic?.first?.pass).length,
    candidatePass: evaluated.filter((source) => source.automatic?.best?.pass).length,
    assistedFirstPass: evaluated.filter((source) => source.assisted?.first?.pass).length,
    assistedCandidatePass: evaluated.filter((source) => source.assisted?.best?.pass).length,
    replayPass: evaluated.filter((source) => source.replay).length,
    expectedEntries: evaluated.reduce((sum, source) => sum + (source.expected ?? 0), 0),
    firstCorrect: evaluated.reduce(
      (sum, source) => sum + (source.automatic?.first?.correct ?? 0),
      0,
    ),
    firstPredicted: evaluated.reduce(
      (sum, source) => sum + (source.automatic?.first?.predicted ?? 0),
      0,
    ),
    bestCorrect: evaluated.reduce((sum, source) => sum + (source.automatic?.best?.correct ?? 0), 0),
    bestPredicted: evaluated.reduce(
      (sum, source) => sum + (source.automatic?.best?.predicted ?? 0),
      0,
    ),
    knownDates: evaluated.reduce((sum, source) => sum + (source.knownDates ?? 0), 0),
    correctDates: evaluated.reduce(
      (sum, source) => sum + (source.automatic?.best?.dateCorrect ?? 0),
      0,
    ),
  };
  const result = {
    version: 1,
    split: corpus.split,
    evaluatedAt: new Date().toISOString(),
    manifestSha256: createHash('sha256').update(bytes).digest('hex'),
    parserSha256,
    criteria: {
      precision: 0.95,
      recall: 0.9,
      match: 'normalized title AND absolute URL; dates evaluated separately',
      selection: 'best is oracle-assisted coverage, NOT automatic first choice',
    },
    summary,
    cases,
  };
  if (values.out) await writeFile(values.out, JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        split: corpus.split,
        summary,
        pages: cases.map((source) => ({
          id: source.id,
          outcome: source.outcome,
          candidates: source.automatic?.count,
          first: source.automatic?.first && {
            correct: source.automatic.first.correct,
            predicted: source.automatic.first.predicted,
            pass: source.automatic.first.pass,
          },
          best: source.automatic?.best && {
            index: source.automatic.best.index,
            correct: source.automatic.best.correct,
            predicted: source.automatic.best.predicted,
            pass: source.automatic.best.pass,
            dates: source.automatic.best.dateCorrect,
          },
          assisted: source.assisted?.first?.pass,
          replay: source.replay,
        })),
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
