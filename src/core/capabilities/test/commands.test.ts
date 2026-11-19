import { expect, it } from 'vitest';
import { commandPrompt, registerCommandDomain } from '../commands';

it('系统提示只列出 Skill 未停用的命令域，全部停用时不提 dela', () => {
  for (const name of ['canvas', 'todo'])
    registerCommandDomain({
      name,
      description: `${name} 能力`,
      skill: { name, files: [] },
      commands: {},
    });

  expect(commandPrompt(new Set(['canvas']))).toContain('- todo：todo 能力');
  expect(commandPrompt(new Set(['canvas']))).not.toContain('canvas');
  expect(commandPrompt(new Set(['canvas', 'todo']))).toBeNull();
});
