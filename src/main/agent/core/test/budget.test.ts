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
  it('窗口 32768、预留 12288、预算 20480、阈值 14336', () => {
    expect(contextBudget()).toEqual({
      window: 32768,
      reserve: 12288,
      budget: 20480,
      compactThreshold: 14336,
    });
  });
});

describe('shouldCompact', () => {
  it('阈值边界：14335 不触发、14336 触发', () => {
    expect(shouldCompact(14335)).toBe(false);
    expect(shouldCompact(14336)).toBe(true);
  });
});
