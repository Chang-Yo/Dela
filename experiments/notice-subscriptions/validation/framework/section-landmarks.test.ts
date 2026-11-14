import { expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from '../../parser';

const pageUrl = 'https://unseen-department.example/notices/';

it('keeps article announcements when a footer links to an author profile', () => {
  const html =
    '<main><h2>Notices</h2>' +
    [1, 2]
      .map(
        (id) =>
          `<article><h3><a href="/notice/${id}">Department announcement ${id}</a></h3><time datetime="2026-11-12">2026-11-12</time><footer><a href="/authors/editor">Editor profile</a></footer></article>`,
      )
      .join('') +
    '</main>';
  const result = analyzeNoticePage(html, pageUrl);
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0]!;
  expect(candidate.entries).toEqual(
    [1, 2].map((id) => ({
      id: `https://unseen-department.example/notice/${id}`,
      title: `Department announcement ${id}`,
      url: `https://unseen-department.example/notice/${id}`,
      publishedAt: '2026-11-12',
    })),
  );
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});

it('does not discover a global header as an announcement list', () => {
  const html =
    '<header><ul><li><a href="/about">About the department</a></li><li><a href="/people">Department directory</a></li></ul></header><main><h1>Welcome</h1></main>';
  expect(analyzeNoticePage(html, pageUrl).candidates).toEqual([]);
});

it.each(['article', 'section'])('keeps announcement titles in a local %s header', (tag) => {
  const html =
    '<main><h2>Notices</h2>' +
    [1, 2]
      .map(
        (id) =>
          `<${tag}><header class="header"><h3><a href="/notice/${id}">Department announcement ${id}</a></h3></header><time datetime="2026-11-12">2026-11-12</time></${tag}>`,
      )
      .join('') +
    '</main>';
  const result = analyzeNoticePage(html, pageUrl);
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0]!;
  expect(candidate.entries.map(({ title, url }) => ({ title, url }))).toEqual(
    [1, 2].map((id) => ({
      title: `Department announcement ${id}`,
      url: `https://unseen-department.example/notice/${id}`,
    })),
  );
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
});
