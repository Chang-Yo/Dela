import { describe, expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from '../../parser';

const pageUrl = 'https://unseen-campus.example/notices/index.html';
const row = (id: string, title: string, dated = true) =>
  `<li><a href="/articles/${id}.html">${title}</a>${dated ? '<time>2026-11-10</time>' : ''}</li>`;

describe('column aggregation guards', () => {
  it('keeps undated navigation apart from dated records with the same column label', () => {
    const html = `<main><section><h2>通知公告</h2><ul class="categories">${row('category-a', '本科通知公告栏目', false)}${row('category-b', '研究生通知公告栏目', false)}</ul><ul class="notices">${row('one', '关于课程安排的通知')}${row('two', '关于项目申报的通知')}</ul></section></main>`;
    const candidates = analyzeNoticePage(html, pageUrl).candidates;
    expect(candidates[0]?.entries.map(({ title }) => title)).toEqual([
      '关于课程安排的通知',
      '关于项目申报的通知',
    ]);
    expect(candidates.every(({ entries }) => entries.length <= 2)).toBe(true);
  });

  it('does not merge distinct tab panels solely because their fallback labels match', () => {
    const html = `<html><head><title>学院通知</title></head><body><main><div id="tabs"><div id="tab1-a"><ul>${row('a-one', '第一栏课程安排通知')}${row('a-two', '第一栏项目申报通知')}</ul></div><div id="tab1-b"><ul>${row('b-one', '第二栏报名时间通知')}${row('b-two', '第二栏材料提交通知')}</ul></div></div></main></body></html>`;
    const candidates = analyzeNoticePage(html, pageUrl).candidates;
    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ entries }) => entries.map(({ title }) => title))).toEqual(
      expect.arrayContaining([
        ['第一栏课程安排通知', '第一栏项目申报通知'],
        ['第二栏报名时间通知', '第二栏材料提交通知'],
      ]),
    );
  });

  it('keeps a complete sample match when an enclosing group uses another title for its URL', () => {
    const title = '关于博士研究生招生报名与材料提交安排的完整通知';
    const html = `<main><div id="cards"><div class="card"><h3><a href="/articles/one.html">关于博士研究生招生报名…</a></h3><ul>${row('one', title)}</ul></div><div class="card"><h3><a href="/articles/two.html">关于项目申报的通知</a></h3><time>2026-11-10</time></div></div></main>`;
    const candidate = analyzeNoticePage(html, pageUrl, { sampleTitle: title }).candidates[0];
    expect(candidate?.entries).toEqual([
      {
        id: 'https://unseen-campus.example/articles/one.html',
        url: 'https://unseen-campus.example/articles/one.html',
        title,
        publishedAt: '2026-11-10',
      },
    ]);
    expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate!.rule)))).toEqual(
      candidate?.entries,
    );
  });
});
