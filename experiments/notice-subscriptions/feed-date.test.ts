import { describe, expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from './parser';

const pageUrl = 'https://unknown-school.example/feed';

describe.each(['rss', 'atom'])('%s publication dates', (format) => {
  it.each([
    ['2026-11-01', '2026-11-01'],
    ['2024-02-29', '2024-02-29'],
    ['2026-11-01T00:30:00+08:00', '2026-10-31T16:30:00.000Z'],
    ['2026-11-01T08:30:00.123Z', '2026-11-01T08:30:00.123Z'],
    ['2026-11-01T08:00:00+0800', '2026-11-01T00:00:00.000Z'],
    ['2026-11-01T08:00+08:00', '2026-11-01T00:00:00.000Z'],
    ['2026-11-01T08:00Z', '2026-11-01T08:00:00.000Z'],
    ['2026-11-01t08:00:00z', '2026-11-01T08:00:00.000Z'],
    ['2026-11-01 08:00:00+08:00', '2026-11-01T00:00:00.000Z'],
    ['2026-02-30T08:00+0800', null],
    ['Wed, 11 Nov 2026 08:00:00 +0800', '2026-11-11T00:00:00.000Z'],
    ['Thu, 29 Feb 2024 00:00:00 GMT', '2024-02-29T00:00:00.000Z'],
    ['Wed, 11 Nov 2026 23:30:00 -0500', '2026-11-12T04:30:00.000Z'],
    ['Thu, 29 Feb 24 00:00:00 GMT', '2024-02-29T00:00:00.000Z'],
    ['Wed, 11 Nov 2026 08:00:00 EST', '2026-11-11T13:00:00.000Z'],
    ['2026-02-30', null],
    ['2026-02-30T00:00:00Z', null],
    ['2025-02-29T00:00:00+08:00', null],
    ['2026-04-31T00:00:00Z', null],
    ['Mon, 30 Feb 2026 00:00:00 GMT', null],
    ['Sat, 29 Feb 2025 00:00:00 +0800', null],
    ['2026-11-01T24:00:00Z', null],
    ['Sun, 01 Nov 2026 24:00:00 GMT', null],
    ['2026-11-01T08:60:00Z', null],
    ['Sun, 01 Nov 2026 08:00:00 +2460', null],
    ['2026-11-01T08:00:00+24:60', null],
    ['2026-11-01T08:00:00', null],
    ['Sun, 01 Nov 2026 08:00:00', null],
    ['11-11', null],
    ['2026-11', null],
    ['November 11', null],
    ['', null],
  ])('preserves valid precision and rejects invalid or ambiguous input %s', (input, expected) => {
    const xml =
      format === 'rss'
        ? `<rss><channel><title>School notices</title><item><title>School announcement</title><link>https://unknown-school.example/news/1</link><pubDate>${input}</pubDate></item></channel></rss>`
        : `<feed xmlns="http://www.w3.org/2005/Atom"><title>School notices</title><entry><title>School announcement</title><link href="https://unknown-school.example/news/1"/><published>${input}</published></entry></feed>`;
    const candidate = analyzeNoticePage(xml, pageUrl).candidates[0]!;
    expect(candidate.entries).toHaveLength(1);
    expect(candidate.entries[0]?.publishedAt).toBe(expected);
    expect(extractNoticeEntries(xml, candidate.rule)).toEqual(candidate.entries);
  });

  it('keeps a missing publication date unknown even when an update date exists', () => {
    const xml =
      format === 'rss'
        ? '<rss><channel><title>School notices</title><lastBuildDate>Wed, 11 Nov 2026 00:00:00 GMT</lastBuildDate><item><title>School announcement</title><link>https://unknown-school.example/news/1</link></item></channel></rss>'
        : '<feed xmlns="http://www.w3.org/2005/Atom"><title>School notices</title><entry><title>School announcement</title><link href="https://unknown-school.example/news/1"/><updated>2026-11-11T00:00:00Z</updated></entry></feed>';
    const candidate = analyzeNoticePage(xml, pageUrl).candidates[0]!;
    expect(candidate.entries[0]?.publishedAt).toBeNull();
    expect(extractNoticeEntries(xml, candidate.rule)).toEqual(candidate.entries);
  });
});
