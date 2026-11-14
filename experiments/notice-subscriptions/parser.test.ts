import { describe, expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from './parser';

const pageUrl = 'https://new-school.example/notice/list.html';
const listing = (rows: string, title = '学院通知') =>
  `<html><head><title>${title}</title></head><body><nav><a href="/about">学院介绍</a><a href="/contact">联系我们</a></nav><main><h2>通知公告</h2><ul id="notices">${rows}</ul></main></body></html>`;
const row = (id: number, title: string, date = '2026-11-11') =>
  `<li><time>${date}</time><a href="/article?id=${id}">${title}</a></li>`;

describe('notice discovery', () => {
  it('discovers an unknown-domain list and preserves article query IDs', () => {
    const result = analyzeNoticePage(
      listing(row(1, '关于课程安排的通知') + row(2, '关于项目申报的通知')),
      pageUrl,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.entries).toEqual([
      {
        id: 'https://new-school.example/article?id=1',
        url: 'https://new-school.example/article?id=1',
        title: '关于课程安排的通知',
        publishedAt: '2026-11-11',
      },
      {
        id: 'https://new-school.example/article?id=2',
        url: 'https://new-school.example/article?id=2',
        title: '关于项目申报的通知',
        publishedAt: '2026-11-11',
      },
    ]);
  });

  it('replays a serialized rule across a new article and list reordering', () => {
    const html = listing(row(1, '关于课程安排的通知') + row(2, '关于项目申报的通知'));
    const rule = analyzeNoticePage(html, pageUrl).candidates[0]!.rule;
    const entries = extractNoticeEntries(
      listing(
        row(3, '关于报名开始的通知') + row(2, '项目申报通知修订') + row(1, '关于课程安排的通知'),
      ),
      JSON.parse(JSON.stringify(rule)),
    );
    expect(entries.map((entry) => entry.id)).toEqual(
      [3, 2, 1].map((id) => `https://new-school.example/article?id=${id}`),
    );
  });
});

it('finds classless table rows and associates each title with its own date', () => {
  const html =
    '<table><tbody><tr><td>2026.11.10</td><td><a href="../one.html">第一条学院公告</a></td></tr><tr><td>2026年11月11日</td><td><a href="../two.html">第二条学院公告</a></td></tr></tbody></table>';
  const result = analyzeNoticePage(html, pageUrl);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]?.entries.map(({ url, publishedAt }) => [url, publishedAt])).toEqual([
    ['https://new-school.example/one.html', '2026-11-10'],
    ['https://new-school.example/two.html', '2026-11-11'],
  ]);
});

it('finds whole-card anchors without treating a thumbnail as another article', () => {
  const html =
    '<div id="cards"><a href="/one"><time>2026-11-10</time><h3>卡片形式第一条公告</h3>查看更多</a><a href="/two"><h3>卡片形式第二条公告</h3>查看更多</a></div>';
  const candidate = analyzeNoticePage(html, pageUrl).candidates[0]!;
  expect(candidate.entries.map(({ title }) => title)).toEqual([
    '卡片形式第一条公告',
    '卡片形式第二条公告',
  ]);
  expect(candidate.entries[1]?.publishedAt).toBeNull();
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});

it('handles split day and year/month without introducing institution rules', () => {
  const html =
    '<div><ul><li><div><h2>09</h2><p>2026.11</p></div><div><a href="/one"><h2>第一条分离日期公告</h2></a></div></li><li><div><h2>10</h2><p>2026.11</p></div><div><a href="/two"><h2>第二条分离日期公告</h2></a></div></li></ul></div>';
  expect(
    analyzeNoticePage(html, pageUrl).candidates[0]?.entries.map((entry) => entry.publishedAt),
  ).toEqual(['2026-11-09', '2026-11-10']);
});

it('keeps separate columns and uses a title example to select the intended group', () => {
  const html =
    '<section><h2>学院新闻</h2><ul>' +
    row(1, '学院举行学术交流活动') +
    row(2, '学院举办开放日活动') +
    '</ul></section><section><h2>通知公告</h2><ul>' +
    row(3, '关于项目申报的通知') +
    row(4, '关于课程安排的通知') +
    '</ul></section>';
  expect(analyzeNoticePage(html, pageUrl).candidates).toHaveLength(2);
  const assisted = analyzeNoticePage(html, pageUrl, { sampleTitle: '关于项目申报的通知' });
  expect(assisted.candidates).toHaveLength(1);
  expect(assisted.candidates[0]?.entries.map((entry) => entry.id)).toEqual(
    [3, 4].map((id) => `https://new-school.example/article?id=${id}`),
  );
  expect(analyzeNoticePage(html, pageUrl, { sampleTitle: '不存在的公告标题' }).status).toBe(
    'unsupported',
  );
});

it('does not turn navigation, hidden copies or a single article into a list', () => {
  const html =
    '<nav><ul>' +
    row(1, '学院介绍页面') +
    row(2, '学院联系我们') +
    '</ul></nav><div hidden><ul>' +
    row(3, '隐藏第一条公告') +
    row(4, '隐藏第二条公告') +
    '</ul></div><article><h1>一篇公告正文</h1><p>这里没有公告列表。</p></article>';
  expect(analyzeNoticePage(html, pageUrl).candidates).toEqual([]);
});

it('allows explicit sample-assisted setup for a list with one item', () => {
  const html = listing(row(1, '当前只有一条学院公告'));
  expect(analyzeNoticePage(html, pageUrl).status).toBe('unsupported');
  const assisted = analyzeNoticePage(html, pageUrl, { sampleTitle: '当前只有一条学院公告' });
  expect(assisted.candidates).toHaveLength(1);
  expect(assisted.candidates[0]?.entries).toHaveLength(1);
});

it('does not invent dates for missing, partial or invalid publication dates', () => {
  const html = listing(
    row(1, '缺少发布日期的公告', '') +
      row(2, '不合法日期的公告', '2026-02-30') +
      row(3, '没有年份的公告', '11-11'),
  );
  expect(
    analyzeNoticePage(html, pageUrl).candidates[0]?.entries.every(
      (entry) => entry.publishedAt === null,
    ),
  ).toBe(true);
});

it('ignores unsafe links, pagination and duplicate links while retaining pinned entries', () => {
  const html = listing(
    '<li class="pinned"><a href="/one">第一条置顶的学院公告</a><a href="/one">查看详情</a></li><li><a href="/two">第二条普通学院公告</a></li><li><a href="javascript:alert(1)">不安全的链接</a></li><li><a href="/page2">下一页</a></li>',
  );
  const candidate = analyzeNoticePage(html, pageUrl).candidates[0]!;
  expect(candidate.entries.map((entry) => entry.url)).toEqual([
    'https://new-school.example/one',
    'https://new-school.example/two',
  ]);
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});

it('reports rule failure on a redesign or an empty replacement instead of silently rebinding', () => {
  const rule = analyzeNoticePage(
    listing(row(1, '第一条学院公告') + row(2, '第二条学院公告')),
    pageUrl,
  ).candidates[0]!.rule;
  expect(() =>
    extractNoticeEntries('<ul id="replacement">' + row(3, '其他栏目的一条公告') + '</ul>', rule),
  ).toThrow('失配');
  expect(() => extractNoticeEntries(listing(''), rule)).toThrow('失配');
});

it.each(['rss', 'atom'])('supports a native %s source and replays it', (kind) => {
  const rss =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>公告订阅</title><item><title>第一条学院公告</title><link>https://other.example/article/1</link><pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>';
  const atom =
    '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>公告订阅</title><entry><title>第一条学院公告</title><link rel="alternate" href="https://other.example/article/1"/><published>2026-11-10T08:00:00Z</published></entry></feed>';
  const html = kind === 'rss' ? rss : atom;
  const candidate = analyzeNoticePage(html, pageUrl).candidates[0]!;
  expect(candidate.rule.kind).toBe('feed');
  expect(candidate.entries[0]?.publishedAt).toBe('2026-11-10T08:00:00.000Z');
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});

it('retains HTML candidates alongside a discovered feed link', () => {
  const html = listing(row(1, '第一条学院公告') + row(2, '第二条学院公告')).replace(
    '</head>',
    '<link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>',
  );
  const result = analyzeNoticePage(html, pageUrl);
  expect(result.feeds[0]?.url).toBe('https://new-school.example/feed.xml');
  expect(result.candidates).toHaveLength(1);
});

it('decodes raw bytes using page metadata', () => {
  const prefix = Buffer.from('<meta charset="windows-1252"><ul><li><a href="/one">Universit');
  const html = Buffer.concat([
    prefix,
    Buffer.from([0xe9]),
    Buffer.from(' publication one</a></li><li><a href="/two">Second publication</a></li></ul>'),
  ]);
  expect(analyzeNoticePage(html, pageUrl).candidates[0]?.entries[0]?.title).toBe(
    'Université publication one',
  );
});

it('excludes navigation implemented with div classes instead of semantic tags', () => {
  const html =
    '<div class="site-header"><ul>' +
    row(10, '学院介绍页面') +
    row(11, '学院联系我们') +
    '</ul></div><div class="menu"><ul>' +
    row(12, '学院教学安排') +
    row(13, '学院科研概况') +
    '</ul></div>' +
    listing(row(1, '第一条学院公告') + row(2, '第二条学院公告'));
  expect(analyzeNoticePage(html, pageUrl).candidates).toHaveLength(1);
});

it('separates dates from title text when the anchor wraps the complete row', () => {
  const html =
    '<ul><li><a href="/one"><div class="li-time"><p>15</p><span>2026.09</span></div><div>第一条学院公告</div></a></li><li><a href="/two"><div class="li-time">2026-11-11</div><div>第二条学院公告</div></a></li></ul>';
  expect(
    analyzeNoticePage(html, pageUrl).candidates[0]?.entries.map((entry) => [
      entry.title,
      entry.publishedAt,
    ]),
  ).toEqual([
    ['第一条学院公告', '2026-09-15'],
    ['第二条学院公告', '2026-11-11'],
  ]);
});

it('learns the repeating row rather than a one-item page wrapper from a sample', () => {
  const single =
    '<div class="wrapper"><div class="content"><ul>' +
    row(1, '当前只有一条学院公告') +
    '</ul></div></div>';
  const updated =
    '<div class="wrapper"><div class="content"><ul>' +
    row(2, '新增的第二条学院公告') +
    row(1, '当前只有一条学院公告') +
    '</ul></div></div>';
  const candidate = analyzeNoticePage(single, pageUrl, { sampleTitle: '当前只有一条学院公告' })
    .candidates[0]!;
  expect(extractNoticeEntries(updated, candidate.rule)).toHaveLength(2);
});

it('keeps the complete repeated-card group when a sample also matches an individual card', () => {
  const html =
    '<div id="cards"><div class="item"><a href="/one">第一条学院公告</a></div><div class="item"><a href="/two">第二条学院公告</a></div></div>';
  const result = analyzeNoticePage(html, pageUrl, { sampleTitle: '第一条学院公告' });
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]?.entries).toHaveLength(2);
});

it('reads inline split dates in DOM order and recognizes camel-case date classes', () => {
  const html =
    '<ul><li><a href="/one"><span class="sTime"><b>18</b>2026.09</span><h4>第一条学院公告</h4></a></li><li><a href="/two"><span class="sTime"><b>17</b>2026.09</span><h4>第二条学院公告</h4></a></li></ul>';
  expect(
    analyzeNoticePage(html, pageUrl).candidates[0]?.entries.map((entry) => entry.publishedAt),
  ).toEqual(['2026-09-18', '2026-09-17']);
});

it('recognizes a nearby wrapped section heading instead of preferring the longest list', () => {
  const news = Array.from({ length: 10 }, (_, i) => row(100 + i, '其他栏目新闻第' + i + '条')).join(
    '',
  );
  const html =
    '<div><div><h2>新闻动态</h2></div><ul>' +
    news +
    '</ul></div><div><div><h2>通知公告</h2><a href="/more">更多</a></div><ul>' +
    row(1, '第一条学院公告') +
    row(2, '第二条学院公告') +
    row(3, '第三条学院公告') +
    '</ul></div>';
  expect(analyzeNoticePage(html, pageUrl).candidates[0]?.entries[0]?.url).toBe(
    'https://new-school.example/article?id=1',
  );
});

it('uses a nearby accessible or image-name section hint when no textual heading exists', () => {
  const html =
    '<div><div><img src="/assets/notice.svg"><a href="/all">更多</a></div><ul>' +
    row(1, '第一条学院公告') +
    row(2, '第二条学院公告') +
    '</ul></div>';
  expect(analyzeNoticePage(html, pageUrl).candidates[0]?.label).toMatch(/notice/i);
});

it('matches a clean sample against a decorative bullet without deleting a candidate title', () => {
  const html =
    '<ul><li><a href="/one"><span class="candidate">· 第一条学院公告</span><span class="publishDate">2026-11-10</span></a></li><li><a href="/two">· 第二条学院公告</a></li></ul>';
  const result = analyzeNoticePage(html, pageUrl, { sampleTitle: '第一条学院公告' });
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]?.entries[0]).toMatchObject({
    title: '第一条学院公告',
    publishedAt: '2026-11-10',
  });
});

it('never removes the document body just because a presentation class mentions header', () => {
  const html =
    '<html><body class="header_white"><ul>' +
    row(1, '第一条学院公告') +
    row(2, '第二条学院公告') +
    '</ul></body></html>';
  expect(analyzeNoticePage(html, pageUrl).candidates[0]?.entries).toHaveLength(2);
});

it('retains content inside presentation wrappers and preserves sibling selector positions', () => {
  const html =
    '<div class="block small-block has-secondary-menu"><div class="menu"><ul>' +
    row(10, '菜单中的通知入口') +
    row(11, '菜单中的新闻入口') +
    '</ul></div><div><ul>' +
    row(1, '第一条学院公告') +
    row(2, '第二条学院公告') +
    '</ul></div></div>';
  const candidate = analyzeNoticePage(html, pageUrl).candidates[0]!;
  expect(candidate.entries.map((entry) => entry.url)).toEqual(
    [1, 2].map((id) => `https://new-school.example/article?id=${id}`),
  );
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});

it('does not accept an old rule when the target becomes a navigation region', () => {
  const html = listing(row(1, '第一条学院公告') + row(2, '第二条学院公告'));
  const rule = analyzeNoticePage(html, pageUrl).candidates[0]!.rule;
  expect(() =>
    extractNoticeEntries(
      html.replace('<ul id="notices">', '<ul id="notices" role="navigation">'),
      rule,
    ),
  ).toThrow('失配');
});

it('separates an unlabelled date block without stripping dates from an article title', () => {
  const html =
    '<ul><li><a href="/one"><div class="top"><span>2026/07/</span>31</div><div class="desc">第一条学院公告</div></a></li><li><a href="/two"><div><span>2026/07/</span>29</div><div>2026/08/01 报名截止通知</div></a></li></ul>';
  const candidate = analyzeNoticePage(html, pageUrl).candidates[0]!;
  expect(candidate.entries.map(({ title, publishedAt }) => [title, publishedAt])).toEqual([
    ['第一条学院公告', '2026-07-31'],
    ['2026/08/01 报名截止通知', '2026-07-29'],
  ]);
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});

it('selects a meaningful heading after an earlier numeric day heading', () => {
  const html =
    '<ul><li><a href="/one"><span><h4>11</h4><p>2026-11</p></span><h4 class="bt">第一条学院公告</h4></a></li><li><a href="/two"><span><h4>04</h4><p>2026-11</p></span><h4 class="bt">第二条学院公告</h4></a></li></ul>';
  const candidate = analyzeNoticePage(html, pageUrl).candidates[0]!;
  expect(candidate.entries.map((entry) => entry.title)).toEqual([
    '第一条学院公告',
    '第二条学院公告',
  ]);
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});
