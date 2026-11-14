import { describe, expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from '../../parser';

const pageUrl = 'https://unseen.example/notices';
const row = (id: number, date: string | null) =>
  `<li><a href="/notice/${id}">学院公告第 ${id} 条</a>${date ? `<time>${date}</time>` : ''}</li>`;

describe('independent review regressions', () => {
  it('replays overlapping layout entries without losing the more complete date', () => {
    const html = `<main><section id="notices"><h2>通知公告</h2><ul class="desktop">${row(1, '2026-11-10')}${row(2, '2026-11-10')}</ul><ul class="mobile">${row(2, null)}${row(3, '2026-11-10')}</ul></section></main>`;
    const candidate = analyzeNoticePage(html, pageUrl).candidates.find(
      ({ rule }) => rule.kind === 'html' && rule.parts,
    );
    expect(candidate).toBeDefined();
    expect(candidate!.entries).toHaveLength(3);
    expect(candidate!.entries.find(({ url }) => url.endsWith('/2'))?.publishedAt).toBe(
      '2026-11-10',
    );
    expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate!.rule)))).toEqual(
      candidate!.entries,
    );
  });

  it('rejects a changed local heading inside a confirmed merged column', () => {
    const html = `<main><section id="notices"><h2>通知公告</h2><div class="pinned"><h3>通知公告</h3><ul>${row(1, '2026-11-10')}${row(2, '2026-11-10')}</ul></div><div class="ordinary"><h3>通知公告</h3><ul>${row(3, '2026-11-10')}${row(4, '2026-11-10')}</ul></div></section></main>`;
    const candidate = analyzeNoticePage(html, pageUrl).candidates.find(
      ({ rule }) => rule.kind === 'html' && rule.parts,
    );
    expect(candidate).toBeDefined();
    expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate!.rule)))).toEqual(
      candidate!.entries,
    );
    const changed = html
      .replace('<div class="ordinary"><h3>通知公告</h3>', '<div class="ordinary"><h3>校友新闻</h3>')
      .replace('/notice/3', '/news/33')
      .replace('/notice/4', '/news/44');
    expect(() =>
      extractNoticeEntries(changed, JSON.parse(JSON.stringify(candidate!.rule))),
    ).toThrow(/重新确认/);
  });
});
