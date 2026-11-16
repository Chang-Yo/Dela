import { describe, expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from '../parser';

const pageUrl = 'https://new-campus.example/';
const rows = (column: string) =>
  [1, 2]
    .map(
      (index) =>
        `<div><a href="/${column}/${index}">${column}栏目独立公告第${index}条</a><time>2026-11-10</time></div>`,
    )
    .join('');

describe('nested tab panel isolation', () => {
  it.each([
    ['semantic panel', 'role="tabpanel"', 'role="tabpanel"'],
    ['named panel', 'id="tab1-a"', 'id="tab1-b"'],
  ])('keeps wrapped %s columns separate with and without a title sample', (_, first, second) => {
    const html = `<section><h2>校园动态</h2><div><div ${first}>${rows('教学')}</div></div><div><div ${second}>${rows('科研')}</div></div></section>`;
    for (const sampleTitle of [undefined, '教学栏目独立公告第1条']) {
      const candidates = analyzeNoticePage(html, pageUrl, { sampleTitle }).candidates;
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        const columns = new Set(
          candidate.entries.map(({ url }) => new URL(url).pathname.split('/')[1]),
        );
        expect(columns.size).toBe(1);
        expect(candidate.entries).toHaveLength(2);
        expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate.rule)))).toEqual(
          candidate.entries,
        );
      }
      if (sampleTitle) {
        expect(candidates[0]?.entries.map(({ title }) => title)).toEqual([
          '教学栏目独立公告第1条',
          '教学栏目独立公告第2条',
        ]);
      }
    }
  });

  it('still combines layouts inside a single enclosing tab panel', () => {
    const html = `<section role="tabpanel"><h2>通知公告</h2><div><div>${rows('教学')}</div></div><div><div>${rows('置顶')}</div></div></section>`;
    const candidate = analyzeNoticePage(html, pageUrl).candidates[0];
    expect(candidate?.entries).toHaveLength(4);
    expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate!.rule)))).toEqual(
      candidate?.entries,
    );
  });
});
