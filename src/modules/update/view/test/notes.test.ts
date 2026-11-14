// @vitest-environment jsdom
// 更新内容弹窗的数据：取 CHANGELOG 每个版本的条目，按已看过的版本区间合并。
import { beforeEach, expect, it } from 'vitest';
import { notesBetween, parseReleaseNotes, takePendingReleaseNotes } from './notes';

const sample = `# Changelog

约定说明不是版本分节。

## Unreleased

- 未发布的不显示

## 1.2.0 - 2026-11-02

- 第二条条目
- 第三条条目

## 1.1.0 - 2026-11-01

## 1.0.5 - 2026-10-20

- 第一条条目
`;

beforeEach(() => localStorage.clear());

it('只收已发布版本，未发布与无条目版本跳过', () => {
  expect(parseReleaseNotes(sample)).toEqual([
    { version: '1.2.0', date: '2026-11-02', items: ['第二条条目', '第三条条目'] },
    { version: '1.0.5', date: '2026-10-20', items: ['第一条条目'] },
  ]);
});

it('跨版本升级合并 (lastSeen, current] 区间，新版本在前', () => {
  const notes = parseReleaseNotes(sample);
  expect(notesBetween(notes, '1.0.4', '1.2.0').map((note) => note.version)).toEqual([
    '1.2.0',
    '1.0.5',
  ]);
  expect(notesBetween(notes, '1.2.0', '1.2.0')).toEqual([]);
  expect(notesBetween(notes, '1.0.5', '1.10.0').map((note) => note.version)).toEqual(['1.2.0']);
});

it('首次安装只记录版本不弹，同版本再次启动也不弹', () => {
  expect(takePendingReleaseNotes('1.0.4')).toEqual([]);
  expect(localStorage.getItem('dela.release-notes.last-seen')).toBe('1.0.4');
  expect(takePendingReleaseNotes('1.0.4')).toEqual([]);
});
