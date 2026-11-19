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
  description: string;
  skill?: BuiltinSkill;
  commands: Record<string, Command>;
}

const domains: CommandDomain[] = [];

export function registerCommandDomain(domain: CommandDomain): void {
  domains.push(domain);
}

export function enabledCommandDomains(disabledSkills: ReadonlySet<string>): CommandDomain[] {
  return domains.filter((domain) => !domain.skill || !disabledSkills.has(domain.skill.name));
}

export function commandPrompt(disabledSkills: ReadonlySet<string>): string | null {
  const enabled = enabledCommandDomains(disabledSkills);
  if (enabled.length === 0) return null;
  return [
    "下列能力在 bash 里用 `dela <命令> '<JSON>'` 调用，先 `dela help` 查看命令与参数；对应领域的 skill 有更完整的说明：",
    ...enabled.map((domain) => `- ${domain.name}：${domain.description}`),
  ].join('\n');
}

export function builtinSkills(): BuiltinSkill[] {
  return domains.flatMap((domain) => (domain.skill ? [domain.skill] : []));
}
