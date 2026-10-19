import { describe, expect, it } from 'vitest';
import { parseReviewTabId, reviewTabId, reviewTabTitle } from './tab-id';

const sessionId = '0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4d';
const turnId = '0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4e';
const path = 'src/main/agent/session.ts';

describe('reviewTabId / parseReviewTabId', () => {
  it('轮次变体往返无损：路径段含冒号（Windows 盘符）也能解析', () => {
    const windowsPath = 'E:\\Zhixi\\Documents\\Dela\\workspace\\Test\\quicksort.py';
    const tabId = reviewTabId({ kind: 'turn', sessionId, turnId, path: windowsPath });
    expect(parseReviewTabId(tabId)).toEqual({
      kind: 'turn',
      sessionId,
      turnId,
      path: windowsPath,
    });
  });

  it('未提交改动变体往返无损，与轮次变体无歧义', () => {
    const tabId = reviewTabId({ kind: 'uncommitted', sessionId });
    expect(tabId).toBe(`review:${sessionId}:uncommitted`);
    expect(parseReviewTabId(tabId)).toEqual({ kind: 'uncommitted', sessionId });
    // 轮次解析不吞掉聚合变体，反之亦然。
    expect(parseReviewTabId(reviewTabId({ kind: 'turn', sessionId, turnId, path }))).toEqual({
      kind: 'turn',
      sessionId,
      turnId,
      path,
    });
  });

  it('非法载荷返回 null', () => {
    expect(parseReviewTabId('review:')).toBeNull();
    expect(parseReviewTabId('review:short:path')).toBeNull();
    expect(parseReviewTabId('review:uncommitted')).toBeNull();
    expect(parseReviewTabId(`${sessionId}:${turnId}:${path}`)).toBeNull();
  });
});

describe('reviewTabTitle', () => {
  it('轮次变体取路径末段作标题，跨平台分隔符都能截', () => {
    expect(reviewTabTitle(reviewTabId({ kind: 'turn', sessionId, turnId, path }))).toBe(
      'session.ts',
    );
    expect(
      reviewTabTitle(
        reviewTabId({ kind: 'turn', sessionId, turnId, path: 'E:\\dir\\quicksort.py' }),
      ),
    ).toBe('quicksort.py');
  });
});
