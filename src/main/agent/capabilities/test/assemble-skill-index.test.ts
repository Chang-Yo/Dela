// Skill 索引段注入点（context/assemble 消费 getCapabilityRuntime().skillIndex）：
// 有启用 Skill 时 system 追加紧凑索引，无则保持 SYSTEM_PROMPT 原样。
import { describe, expect, it, vi } from 'vitest';
import { assembleModelContext, SYSTEM_PROMPT } from '../../context/assemble';
import { setCapabilityRuntime } from '../index';
import type { CapabilityRuntime } from '../types';

const runtimeOf = (entries: { name: string; description: string }[]): CapabilityRuntime => ({
  skillIndex: () => entries,
  mcpToolDefinitions: () => [],
  executeMcpTool: vi.fn(),
});

describe('Skill 索引段注入 system', () => {
  it('有启用 Skill 时追加「可用 Skills」索引（名称: 描述）', () => {
    setCapabilityRuntime(
      runtimeOf([
        { name: 'thesis', description: '论文写作规范' },
        { name: 'mail-etiquette', description: '' },
      ]),
    );
    const result = assembleModelContext({ history: [], summary: null, reservedTokens: 0 });
    expect(result.system).toContain(SYSTEM_PROMPT);
    expect(result.system).toContain('可用 Skills（需要时调用 read_skill 读取完整说明）');
    expect(result.system).toContain('- thesis: 论文写作规范');
    expect(result.system).toContain('- mail-etiquette: （无描述）');
    expect(result.system.indexOf(SYSTEM_PROMPT)).toBeLessThan(result.system.indexOf('可用 Skills'));
  });

  it('无启用 Skill 时 system 保持 SYSTEM_PROMPT 原样', () => {
    setCapabilityRuntime(runtimeOf([]));
    const result = assembleModelContext({ history: [], summary: null, reservedTokens: 0 });
    expect(result.system).toBe(SYSTEM_PROMPT);
  });
});
