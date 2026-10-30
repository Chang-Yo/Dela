import { describe, expect, it } from 'vitest';
import { selectCanvasCacheEntries } from './cache-policy';

const now = 100_000;
const entry = (key: string, bytes: number, lastUsedAt: number, term = 'old', pinned = false) => ({
  key,
  path: `/${key}`,
  bytes,
  term,
  courseId: 1,
  lastUsedAt,
  pinned,
});

describe('Canvas 缓存自动清理策略', () => {
  it('按最近使用时间清理到容量上限，并保留固定文件', () => {
    expect(
      selectCanvasCacheEntries(
        [entry('old', 60, 1), entry('new', 60, 2), entry('pinned', 60, 1, 'old', true)],
        { maxBytes: 120, keepCurrentTerm: false },
        'current',
        now,
      ).map((item) => item.key),
    ).toEqual(['old']);
  });

  it('只保留当前学期时优先清理旧学期', () => {
    expect(
      selectCanvasCacheEntries(
        [
          entry('current', 50, 1, 'current'),
          entry('old', 50, 9),
          entry('old-pinned', 50, 1, 'old', true),
        ],
        { maxBytes: 100, keepCurrentTerm: true },
        'current',
        now,
      ).map((item) => item.key),
    ).toEqual(['old']);
  });

  it('保护最近使用的文件，避免刚打开的课件被立即清理', () => {
    expect(
      selectCanvasCacheEntries(
        [entry('recent', 100, now - 1), entry('old', 100, 1)],
        { maxBytes: 100, keepCurrentTerm: false },
        'current',
        now,
      ).map((item) => item.key),
    ).toEqual(['old']);
  });
});
