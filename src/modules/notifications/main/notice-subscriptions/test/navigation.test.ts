import { expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from '../parser';

it.each(['menu-container', 'subMenu', 'sub-category-nav'])(
  'excludes %s while retaining an undated content list',
  (marker) => {
    const html =
      '<div class="' +
      marker +
      '"><ul><li><a href="/about">About the faculty</a></li><li><a href="/contact">Contact the faculty</a></li></ul></div><div class="has-secondary-menu"><ul id="content"><li><a href="/article/1">First announcement without a date</a></li><li><a href="/article/2">Second announcement without a date</a></li></ul></div>';
    const result = analyzeNoticePage(html, 'https://unseen.example/');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.entries.map((entry) => entry.url)).toEqual([
      'https://unseen.example/article/1',
      'https://unseen.example/article/2',
    ]);
    expect(extractNoticeEntries(html, result.candidates[0]!.rule)).toEqual(
      result.candidates[0]!.entries,
    );
  },
);

it.each(['hasMenu', 'with-navigation'])(
  'keeps a content wrapper with the presentation marker %s',
  (marker) => {
    const html =
      '<div class="' +
      marker +
      '"><ul><li><a href="/one">First undated announcement</a></li><li><a href="/two">Second undated announcement</a></li></ul></div>';
    expect(analyzeNoticePage(html, 'https://unseen.example/').candidates).toHaveLength(1);
  },
);

it.each(['menu', 'menubar'])(
  'excludes an explicit %s role without relying on CSS classes',
  (role) => {
    const html =
      '<div role="' +
      role +
      '"><ul><li><a href="/one">First navigation choice</a></li><li><a href="/two">Second navigation choice</a></li></ul></div>';
    expect(analyzeNoticePage(html, 'https://unseen.example/').candidates).toHaveLength(0);
  },
);

it('rejects a saved content rule when its target becomes a compound navigation component', () => {
  const html =
    '<ul id="content"><li><a href="/one">First undated announcement</a></li><li><a href="/two">Second undated announcement</a></li></ul>';
  const rule = analyzeNoticePage(html, 'https://unseen.example/').candidates[0]!.rule;
  expect(() =>
    extractNoticeEntries(
      html.replace('<ul id="content">', '<ul id="content" class="menu-container">'),
      rule,
    ),
  ).toThrow('失配');
});
