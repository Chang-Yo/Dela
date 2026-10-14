// @vitest-environment jsdom
// 更新内容弹窗的数据：只取 CHANGELOG 的「亮点」，按已看过的版本区间合并。
import { beforeEach, expect, it } from 'vitest';
import { notesBetween, parseReleaseNotes, takePendingReleaseNotes } from './notes';

const sample = `# Changelog

## Unreleased

### 亮点

- 未发布的不显示

## 1.2.0 - 2026-11-02

### 亮点

- 第二条亮点
- 第三条亮点

### Fixed

- 内部修复不进弹窗

## 1.1.0 - 2026-11-01

### Fixed

- 没有亮点的版本

## 1.0.5 - 2026-10-20

### 亮点

- 第一条亮点
`;

beforeEach(() => localStorage.clear());

it('只收已发布且写了亮点的版本，且不混入其他小节', () => {
  expect(parseReleaseNotes(sample)).toEqual([
    { version: '1.2.0', date: '2026-11-02', highlights: ['第二条亮点', '第三条亮点'] },
    { version: '1.0.5', date: '2026-10-20', highlights: ['第一条亮点'] },
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
  expect(takePendingReleaseNotes('1.0.4', true)).toEqual([]);
  expect(localStorage.getItem('dela.release-notes.last-seen')).toBe('1.0.4');
  expect(takePendingReleaseNotes('1.0.4', false)).toEqual([]);
});
