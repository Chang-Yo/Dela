// Skill 索引段注入点（assembleModelContext 的 skillIndex 参数，由 manager 从能力层取后传入）：
// 有启用 Skill 时 system 追加紧凑索引，无则保持 SYSTEM_PROMPT 原样。
import { describe, expect, it } from 'vitest';
import { assembleModelContext, SYSTEM_PROMPT } from '../assemble';

describe('Skill 索引段注入 system', () => {
  it('有启用 Skill 时追加「可用 Skills」索引（名称: 描述）', () => {
    const result = assembleModelContext({
      history: [],
      summary: null,
      reservedTokens: 0,
      skillIndex: [
        { name: 'thesis', description: '论文写作规范' },
        { name: 'mail-etiquette', description: '' },
      ],
    });
    expect(result.system).toContain(SYSTEM_PROMPT);
    expect(result.system).toContain('可用 Skills（需要时调用 read_skill 读取完整说明）');
    expect(result.system).toContain('- thesis: 论文写作规范');
    expect(result.system).toContain('- mail-etiquette: （无描述）');
    expect(result.system.indexOf(SYSTEM_PROMPT)).toBeLessThan(result.system.indexOf('可用 Skills'));
  });

  it('无启用 Skill 时 system 保持 SYSTEM_PROMPT 原样', () => {
    const result = assembleModelContext({
      history: [],
      summary: null,
      reservedTokens: 0,
      skillIndex: [],
    });
    expect(result.system).toBe(SYSTEM_PROMPT);
  });
});
