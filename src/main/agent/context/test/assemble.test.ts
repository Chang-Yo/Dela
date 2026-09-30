// 上下文组装：预算内全量保留（无 12 条上限）、摘要前置块、按预算裁剪、单条超限截断与溢出报错。
import { describe, expect, it } from 'vitest';
import type { WorkspaceChat } from '../../../../shared/api';
import {
  assembleModelContext,
  compactSplitIndex,
  summaryContextText,
  SYSTEM_PROMPT,
} from '../assemble';
import type { SessionSummary } from '../compaction';
import { estimateTokens } from '../../core/budget';

function historyOf(count: number, chars = 100): WorkspaceChat['messages'] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `消息${index}。`.padEnd(chars, '字'),
  }));
}

const summary = (coveredUpTo: number, messageCount: number): SessionSummary => ({
  coveredUpTo,
  createdAt: '2026-09-29T00:00:00.000Z',
  model: 'm',
  content: {
    goals: '目标',
    decisions: '决定',
    completed: '已完成',
    pending: '待办',
    resources: [],
  },
  messageCount,
});

describe('assembleModelContext', () => {
  it('预算内历史全部保留，不再有 12 条上限', () => {
    const history = historyOf(20);
    const result = assembleModelContext({ history, summary: null, reservedTokens: 0, skillIndex: [] });
    expect(result.history).toHaveLength(20);
    expect(result.history[0]).toMatchObject({ role: 'user', content: history[0]!.content });
    expect(result.system).toBe(SYSTEM_PROMPT);
  });

  it('摘要存在时合并进 system 前置块，并标注非资源最新状态', () => {
    const history = historyOf(8);
    const result = assembleModelContext({
      history,
      summary: summary(5, 8),
      reservedTokens: 0,
      skillIndex: [],
    });
    expect(result.system).toContain(SYSTEM_PROMPT);
    expect(result.system).toContain('本会话较早历史摘要');
    expect(result.system).toContain('不是任何资源的最新状态');
    expect(result.system).toContain('目标');
    // 选择从覆盖锚点之后开始（不重复注入已摘要区间）。
    expect(result.history).toHaveLength(3);
    expect(result.history[0]!.content).toBe(history[5]!.content);
  });

  it('摘要覆盖锚点超出当前历史（编辑重发截断）时忽略摘要', () => {
    const history = historyOf(4);
    const result = assembleModelContext({ history, summary: summary(9, 12), reservedTokens: 0, skillIndex: [] });
    expect(result.system).toBe(SYSTEM_PROMPT);
    expect(result.history).toHaveLength(4);
  });

  it('预算不足时从最旧一侧开始放不下（由上游压缩覆盖，组装侧不静默截断其余消息）', () => {
    const history = historyOf(10, 4000); // 每条约 4000 token，预算 20480 只容最近 5 条。
    const result = assembleModelContext({ history, summary: null, reservedTokens: 0, skillIndex: [] });
    expect(result.history).toHaveLength(5);
    expect(result.history[0]!.content).toBe(history[5]!.content);
    expect(result.history.at(-1)!.content).toBe(history[9]!.content);
  });

  it('最新一条单独超预算时截断保留并标注', () => {
    const history = historyOf(2, 30000);
    const result = assembleModelContext({ history, summary: null, reservedTokens: 0, skillIndex: [] });
    expect(result.history).toHaveLength(1);
    expect(result.history[0]!.content).toContain('内容过大已截断');
    // 截断后的估算不超预算。
    expect(estimateTokens(result.history[0]!.content)).toBeLessThanOrEqual(20480);
  });

  it('本轮输入（reservedTokens）加 system 超出预算时明确报错，不静默截断本轮', () => {
    const history = historyOf(3);
    expect(() => assembleModelContext({ history, summary: null, reservedTokens: 20480, skillIndex: [] })).toThrow(
      '本轮输入超出模型上下文预算',
    );
  });
});

describe('compactSplitIndex', () => {
  it('全部放得下时返回 start（无需新压缩）', () => {
    const history = historyOf(4, 100);
    expect(compactSplitIndex(history, 0, 20480)).toBe(0);
  });

  it('放不下时返回应纳入摘要的前缀长度', () => {
    const history = historyOf(10, 4000); // 每条约 4000 token。
    // 容纳 12000 token → 最近 3 条；前缀 7 条纳入摘要。
    expect(compactSplitIndex(history, 0, 12000)).toBe(7);
  });

  it('已有摘要时从锚点起算，不重复压缩已覆盖区间', () => {
    const history = historyOf(10, 4000);
    expect(compactSplitIndex(history, 6, 12000)).toBe(7);
  });

  it('最新一条也放不下时返回全部条数（全量纳入摘要）', () => {
    const history = historyOf(3, 30000);
    expect(compactSplitIndex(history, 0, 100)).toBe(3);
  });
});

describe('summaryContextText', () => {
  it('包含覆盖范围与摘要内容', () => {
    expect(summaryContextText(summary(6, 10))).toContain('第 1–6 条消息');
    expect(summaryContextText(summary(6, 10))).toContain('历史共 10 条时生成');
  });
});
