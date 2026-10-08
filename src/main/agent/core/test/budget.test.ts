// token 估算启发式与上下文预算口径「按预算触发」。
import { describe, expect, it } from 'vitest';
import { contextBudget, estimateTokens, shouldCompact } from '../budget';

describe('estimateTokens', () => {
  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('纯拉丁文本按 4 字符/token 向上取整', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('CJK 按 1 token/字', () => {
    expect(estimateTokens('你好世界')).toBe(4);
  });

  it('中英混合分别计数后相加', () => {
    // 2 个 CJK 字（2）+ 3 个拉丁字符（ceil(3/4)=1）。
    expect(estimateTokens('你好abc')).toBe(3);
  });
});

describe('contextBudget', () => {
  it('uses a model’s configured context window and output reserve', () => {
    expect(contextBudget({ contextWindow: 1000000, maxOutputTokens: 128000 })).toEqual({
      window: 1000000,
      reserve: 132096,
      budget: 867904,
      compactThreshold: 607532,
    });
    expect(shouldCompact(600000, { contextWindow: 1000000, maxOutputTokens: 128000 })).toBe(false);
  });
  it('窗口 256000、预留 12288、预算 243712、阈值 170598', () => {
    expect(contextBudget()).toEqual({
      window: 256000,
      reserve: 12288,
      budget: 243712,
      compactThreshold: 170598,
    });
  });
});

describe('shouldCompact', () => {
  it('阈值边界：170597 不触发、170598 触发', () => {
    expect(shouldCompact(170597)).toBe(false);
    expect(shouldCompact(170598)).toBe(true);
  });
});
