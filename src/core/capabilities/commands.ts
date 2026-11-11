// dela 命令域注册表：core 不认识具体业务，命令连同教 Agent 使用它们的 Skill 由模块注册。
import type { z } from 'zod';

export interface Command {
  description: string;
  schema: z.ZodType;
  execute(input: unknown): unknown;
}

export interface BuiltinSkill {
  name: string;
  files: { path: string; content: string }[];
}

export interface CommandDomain {
  name: string;
  /** 一句话说明：进入系统提示，告诉 Agent 这一域能做什么。 */
  description: string;
  /** 停用这个 Skill 时，本域命令从 dela help 与执行中一并消失。 */
  skill?: BuiltinSkill;
  commands: Record<string, Command>;
}

const domains: CommandDomain[] = [];

export function registerCommandDomain(domain: CommandDomain): void {
  domains.push(domain);
}

/** 所属 Skill 未停用的命令域，按注册顺序。 */
export function enabledCommandDomains(disabledSkills: ReadonlySet<string>): CommandDomain[] {
  return domains.filter((domain) => !domain.skill || !disabledSkills.has(domain.skill.name));
}

export function builtinSkills(): BuiltinSkill[] {
  return domains.flatMap((domain) => (domain.skill ? [domain.skill] : []));
}
