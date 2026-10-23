import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SESSION_COMMANDS, type ChatCommandView } from '../../shared/api';
import { getDatabase } from '../database';

// 设置 › 插件：自定义 / 指令。名称限制为无空白字符，保证能作为触发词输入。
const commandName = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[\p{L}\p{N}_-]+$/u, '名称只能包含文字、数字、下划线或短横线');
const chatCommandInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: commandName,
  prompt: z.string().trim().min(1).max(2000),
});
const chatCommandStoredSchema = z.object({
  id: z.string().uuid(),
  name: commandName,
  prompt: z.string().trim().min(1).max(2000),
});

function readChatCommands(): ChatCommandView[] {
  const row = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='chat-commands'")
    .get() as { value: string } | undefined;
  if (!row) return [];
  try {
    const parsed = z.array(chatCommandStoredSchema).safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function listChatCommands(): ChatCommandView[] {
  return readChatCommands();
}

export function saveChatCommand(input: unknown): ChatCommandView {
  const command = chatCommandInputSchema.parse(input);
  // 与会话命令（/compact 等）同名会让 / 候选里出现两个一样的条目，新建与改名时拒绝。
  if (SESSION_COMMANDS.some((item) => item.name === command.name.toLowerCase()))
    throw new Error(`/${command.name} 是内置命令，请换一个名称`);
  const commands = readChatCommands();
  if (commands.some((item) => item.name === command.name && item.id !== command.id))
    throw new Error('已有同名指令');
  let saved: ChatCommandView;
  if (command.id) {
    const index = commands.findIndex((item) => item.id === command.id);
    if (index < 0) throw new Error('指令不存在');
    saved = { id: command.id, name: command.name, prompt: command.prompt };
    commands[index] = saved;
  } else {
    saved = { id: randomUUID(), name: command.name, prompt: command.prompt };
    commands.push(saved);
  }
  getDatabase()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('chat-commands', ?)")
    .run(JSON.stringify(commands));
  return saved;
}

export function deleteChatCommand(id: string): void {
  const commands = readChatCommands().filter((item) => item.id !== id);
  getDatabase()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('chat-commands', ?)")
    .run(JSON.stringify(commands));
}
