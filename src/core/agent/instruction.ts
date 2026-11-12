// 用户附加指令（设置 › 自定义指令）：随系统提示注入每次 Run，空串不注入。
// 上限与自定义指令正文一致，避免一条偏好挤占过多上下文预算。
import { z } from 'zod';
import { hostPorts } from '../ports';

export const instructionSchema = z.string().trim().max(2000);

/** 键缺失、超长或数据损坏一律回退空串：注入端只关心“有没有内容”。 */
export function getAgentInstruction(): string {
  const row = hostPorts()
    .database()
    .prepare("SELECT value FROM workspace_settings WHERE key='agent-instruction'")
    .get() as { value: string } | undefined;
  return instructionSchema.catch('').parse(row?.value ?? '');
}

export function setAgentInstruction(input: unknown): string {
  const text = instructionSchema.parse(input);
  hostPorts()
    .database()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('agent-instruction', ?)")
    .run(text);
  return text;
}
