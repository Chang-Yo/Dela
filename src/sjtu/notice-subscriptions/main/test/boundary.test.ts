import { describe, expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from '../parser';

const pageUrl = 'https://unseen-campus.example/notices/index.html';
const titles = [
  '关于课程安排的通知',
  '关于项目申报的通知',
  '关于报名时间的通知',
  '关于材料提交的通知',
];
const row = (index: number) =>
  `<li><a href="/articles/${index}.html">${titles[index]}</a><time>2026-11-10</time></li>`;

describe('explicitly expanded notice boundaries', () => {
  it.each([
    ['windowOpen', (url: string) => `windowOpen('${url}')`],
    ['location.href', (url: string) => `location.href='${url}'`],
    ['window.location.href', (url: string) => `window.location.href='${url}';`],
  ] as const)('extracts and replays literal %s destinations', (_name, onclick) => {
    const html = `<main><h2>通知公告</h2><ul>${[0, 1]
      .map(
        (index) =>
          `<li onclick="${onclick(`/articles/${index}.html`)}"><h3>${titles[index]}</h3><time>2026-11-10</time></li>`,
      )
      .join('')}</ul></main>`;
    const candidate = analyzeNoticePage(html, pageUrl).candidates[0];
    expect(candidate).toBeDefined();
    expect(candidate?.entries).toEqual(
      [0, 1].map((index) => ({
        id: `https://unseen-campus.example/articles/${index}.html`,
        url: `https://unseen-campus.example/articles/${index}.html`,
        title: titles[index],
        publishedAt: '2026-11-10',
      })),
    );
    expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate!.rule)))).toEqual(
      candidate?.entries,
    );
  });

  it.each([
    "windowOpen('/articles/' + articleId)",
    "windowOpen(resolveUrl('/articles/0.html'))",
    "location.href='/articles/' + articleId",
    "windowOpen('javascript:alert(1)')",
    "windowOpen('data:text/html,article')",
    "location.href='file:///C:/article.html'",
  ])('rejects executable or non-HTTP destination %s', (onclick) => {
    const html = `<main><h2>通知公告</h2><ul>${[0, 1]
      .map(
        (index) => `<li onclick="${onclick}"><h3>${titles[index]}</h3><time>2026-11-10</time></li>`,
      )
      .join('')}</ul></main>`;
    expect(analyzeNoticePage(html, pageUrl).candidates).toEqual([]);
  });

  it('preserves distinct existing article heading fragments and replays them', () => {
    const html = `<main><h1>维护公告</h1>${[0, 1]
      .map(
        (index) =>
          `<article><h2 id="notice-${index}"><a href="#notice-${index}">${titles[index]}</a></h2><time>2026-11-10</time><p>此条公告的详细内容。</p></article>`,
      )
      .join('')}</main>`;
    const candidate = analyzeNoticePage(html, pageUrl).candidates[0];
    expect(candidate).toBeDefined();
    expect(candidate?.entries.map(({ id, url, title }) => ({ id, url, title }))).toEqual(
      [0, 1].map((index) => ({
        id: `${pageUrl}#notice-${index}`,
        url: `${pageUrl}#notice-${index}`,
        title: titles[index],
      })),
    );
    expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate!.rule)))).toEqual(
      candidate?.entries,
    );
  });

  it('keeps SPA hash routes outside the supported fragment contract', () => {
    const html = `<main><h2>通知公告</h2><ul>${[0, 1]
      .map(
        (index) =>
          `<li><a href="#/notice/${index}">${titles[index]}</a><time>2026-11-10</time></li>`,
      )
      .join('')}</ul></main>`;
    expect(analyzeNoticePage(html, pageUrl).candidates).toEqual([]);
  });

  it('combines pinned cards and ordinary rows within one identified column', () => {
    const html = `<main><section id="notices"><h2>通知公告</h2><div class="pinned">${[0, 1]
      .map(
        (index) =>
          `<article><h3><a href="/articles/${index}.html">${titles[index]}</a></h3><time>2026-11-10</time></article>`,
      )
      .join('')}</div><ul class="ordinary">${row(2)}${row(3)}</ul></section></main>`;
    const candidate = analyzeNoticePage(html, pageUrl).candidates[0];
    expect(candidate?.entries.map(({ title }) => title)).toEqual(titles);
    expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate!.rule)))).toEqual(
      candidate?.entries,
    );
  });

  it('does not combine structurally identical groups from different columns', () => {
    const html = `<main><section><h2>通知公告</h2><ul>${row(0)}${row(1)}</ul></section><section><h2>学院新闻</h2><ul>${row(2)}${row(3)}</ul></section></main>`;
    const candidates = analyzeNoticePage(html, pageUrl).candidates;
    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ entries }) => entries.map(({ title }) => title))).toEqual(
      expect.arrayContaining([titles.slice(0, 2), titles.slice(2)]),
    );
    for (const candidate of candidates) {
      expect(extractNoticeEntries(html, JSON.parse(JSON.stringify(candidate.rule)))).toEqual(
        candidate.entries,
      );
    }
  });
});
