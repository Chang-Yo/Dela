import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { analyzeNoticePage, extractNoticeEntries, noticeRuleSchema } from '../../parser';
import { updateSubscription } from '../../state';
import type { NoticeCandidate, NoticeEntry } from '../../parser';

interface ExpectedEntry {
  title: string;
  url: string;
  publishedAt: string | null;
}
interface Case {
  id: string;
  family: string;
  mode: 'list' | 'reject';
  url: string;
  html: string;
  expected: ExpectedEntry[];
  sampleTitle?: string;
  transforms?: {
    id: string;
    html: string;
    expected?: ExpectedEntry[];
    replay: 'equal' | 'reject-or-equal';
  }[];
}
interface Measurement {
  candidate: NoticeCandidate;
  exact: boolean;
  replayEqual: boolean;
  error?: string;
}
interface Transformation {
  id: string;
  pass: boolean;
  outcome: 'correct' | 'wrong' | 'rejected' | 'error' | 'initial-target-unavailable';
  actual?: NoticeEntry[];
  newEntries?: NoticeEntry[];
  error?: string;
}
interface CaseResult {
  id: string;
  family: string;
  mode: Case['mode'];
  pass: boolean;
  automaticFirstPass?: boolean;
  candidateCoverage?: boolean;
  assistedFirstPass?: boolean;
  first?: Measurement;
  assistedFirst?: Measurement;
  transformations?: Transformation[];
  elapsedMs?: number;
  error?: string;
}

const directory = resolve('experiments/notice-subscriptions/validation/framework');
const source = resolve(process.argv[2] ?? `${directory}/development/corpus.json`);
const destination = resolve(process.argv[3] ?? `${directory}/development-baseline.json`);
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(source);
const corpus = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as
  Case[] | { cases: Case[] };
const cases = Array.isArray(corpus) ? corpus : corpus.cases;
const freeze = JSON.parse(await readFile(resolve(dirname(source), 'freeze.json'), 'utf8'));
if (freeze.corpusSha256 && freeze.corpusSha256 !== digest(bytes))
  throw new Error('Frozen corpus changed');
const before = JSON.parse(await readFile(`${directory}/implementation-before.json`, 'utf8')) as {
  files: { file: string; sha256: string }[];
};
const implementation = await Promise.all(
  before.files.map(async ({ file }) => ({ file, sha256: digest(await readFile(file)) })),
);
const title = (value: string) => value.replace(/\s+/g, ' ').trim();
const date = (value: string | null) => {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'invalid-date' : parsed.toISOString();
};
const exact = (actual: NoticeEntry[], expected: ExpectedEntry[]) =>
  actual.length === expected.length &&
  new Set(actual.map((entry) => entry.id)).size === actual.length &&
  actual.every((entry, index) => {
    const wanted = expected[index]!;
    return (
      entry.id === entry.url &&
      title(entry.title) === title(wanted.title) &&
      new URL(entry.url).href === new URL(wanted.url).href &&
      date(entry.publishedAt) === date(wanted.publishedAt)
    );
  });
const results: CaseResult[] = [];
for (const item of cases) {
  const start = performance.now();
  try {
    const automatic = analyzeNoticePage(item.html, item.url);
    const inspect = (candidate: NoticeCandidate): Measurement => {
      let replayEqual = false;
      let error: string | undefined;
      try {
        const rule = noticeRuleSchema.parse(JSON.parse(JSON.stringify(candidate.rule)));
        replayEqual = isDeepStrictEqual(extractNoticeEntries(item.html, rule), candidate.entries);
      } catch (caught) {
        error = String(caught);
      }
      return { candidate, exact: exact(candidate.entries, item.expected), replayEqual, error };
    };
    const measured = automatic.candidates.map(inspect);
    const assisted =
      item.mode === 'list'
        ? analyzeNoticePage(item.html, item.url, {
            sampleTitle: item.sampleTitle ?? item.expected[0]!.title,
          }).candidates.map(inspect)
        : [];
    const selected = measured.find((value) => value.exact && value.replayEqual);
    const transformations = (item.transforms ?? []).map((transform): Transformation => {
      if (!selected)
        return { id: transform.id, pass: false, outcome: 'initial-target-unavailable' };
      const expected = transform.expected ?? item.expected;
      let entries: NoticeEntry[];
      try {
        entries = extractNoticeEntries(transform.html, selected.candidate.rule);
      } catch (error) {
        const refused = error instanceof Error && /^订阅.*请重新确认$/.test(error.message);
        return {
          id: transform.id,
          pass: transform.replay === 'reject-or-equal' && refused,
          outcome: refused ? 'rejected' : 'error',
          error: String(error),
        };
      }
      try {
        const fieldsEqual = exact(entries, expected);
        const initial = updateSubscription(selected.candidate.rule, selected.candidate.entries);
        const saved = JSON.parse(JSON.stringify(initial.state));
        const unchanged = JSON.stringify(saved);
        const updated = updateSubscription(selected.candidate.rule, entries, saved);
        const wantedNew = expected.filter(
          (entry) =>
            !item.expected.some((old) => new URL(old.url).href === new URL(entry.url).href),
        );
        const repeated = updateSubscription(selected.candidate.rule, entries, updated.state);
        const incrementEqual =
          exact(updated.newEntries, wantedNew) &&
          repeated.newEntries.length === 0 &&
          JSON.stringify(saved) === unchanged;
        return {
          id: transform.id,
          pass: fieldsEqual && incrementEqual,
          outcome: fieldsEqual && incrementEqual ? 'correct' : 'wrong',
          actual: fieldsEqual && incrementEqual ? undefined : entries,
          newEntries: incrementEqual ? undefined : updated.newEntries,
        };
      } catch (error) {
        return {
          id: transform.id,
          pass: false,
          outcome: 'error',
          error: String(error),
        };
      }
    });
    const firstPass = Boolean(measured[0]?.exact && measured[0]?.replayEqual);
    const assistedFirstPass = Boolean(assisted[0]?.exact && assisted[0]?.replayEqual);
    results.push({
      id: item.id,
      family: item.family,
      mode: item.mode,
      automaticFirstPass: item.mode === 'reject' ? automatic.candidates.length === 0 : firstPass,
      candidateCoverage: Boolean(selected),
      assistedFirstPass,
      pass:
        item.mode === 'reject'
          ? automatic.candidates.length === 0
          : Boolean(selected) && assistedFirstPass && transformations.every((value) => value.pass),
      first: measured[0],
      assistedFirst: assisted[0],
      transformations,
      elapsedMs: performance.now() - start,
    });
  } catch (error) {
    results.push({
      id: item.id,
      family: item.family,
      mode: item.mode,
      pass: false,
      error: String(error),
    });
  }
}
for (const { file, sha256 } of implementation) {
  if (digest(await readFile(file)) !== sha256) throw new Error(`Implementation changed: ${file}`);
}
if (digest(await readFile(source)) !== digest(bytes))
  throw new Error('Corpus changed during evaluation');
const positives = results.filter((item) => item.mode === 'list');
const negatives = results.filter((item) => item.mode === 'reject');
const transformations = results.flatMap((item) => item.transformations ?? []);
const summary = {
  total: results.length,
  passed: results.filter((item) => item.pass).length,
  positive: positives.length,
  automaticFirstPass: positives.filter((item) => item.automaticFirstPass).length,
  candidateCoverage: positives.filter((item) => item.candidateCoverage).length,
  assistedFirstPass: positives.filter((item) => item.assistedFirstPass).length,
  negative: negatives.length,
  negativePass: negatives.filter((item) => item.pass).length,
  transformations: transformations.length,
  transformationCorrect: transformations.filter((item) => item.outcome === 'correct').length,
  transformationRejected: transformations.filter((item) => item.outcome === 'rejected').length,
  transformationErrors: transformations.filter((item) => item.outcome === 'error').length,
  transformationSafe: transformations.filter((item) => item.pass).length,
  failed: results.filter((item) => !item.pass).map((item) => item.id),
};
await mkdir(dirname(destination), { recursive: true });
await writeFile(
  destination,
  JSON.stringify(
    {
      evaluatedAt: new Date().toISOString(),
      source,
      corpusSha256: digest(bytes),
      evaluatorSha256: digest(
        await readFile('experiments/notice-subscriptions/validation/framework/evaluate.ts'),
      ),
      implementation,
      criteria: {
        expectedRecords: '100%, ordered, no extra records, complete titles and canonical URLs',
        dates: 'canonical UTC ISO; date-only is UTC midnight; unknown stays null',
        replay: 'all fields exactly identical before canonicalization',
        selection: 'target matching is candidate coverage, not automatic user selection',
        rejection: 'safe refusal recorded separately, never compatibility success',
      },
      summary,
      cases: results,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(summary));
if (summary.passed !== summary.total) process.exitCode = 1;
