// MCP 页签的可测纯逻辑：args/env 文本解析、表单校验、编辑补丁与状态徽标映射。
// 视图契约（McpServerView）不携带 command/args/env，编辑表单因此采用"留空保持原值"的部分补丁。
import type { McpConnectionStatus } from '../../../../../shared/capabilities';

export function parseArgsText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 每行一条 KEY=VALUE（值可为空）；格式错误时返回带行号的错误，env 为已收集部分（调用方先看 error）。 */
export function parseEnvText(text: string): { env: Record<string, string>; error: string | null } {
  const env: Record<string, string> = {};
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line) continue;
    const separator = line.indexOf('=');
    const key = separator < 0 ? '' : line.slice(0, separator).trim();
    if (!key) return { env, error: `环境变量第 ${index + 1} 行应为 KEY=VALUE 格式` };
    env[key] = line.slice(separator + 1).trim();
  }
  return { env, error: null };
}

export interface McpFormInput {
  name: string;
  command: string;
  argsText: string;
  envText: string;
}

export type McpFormParsed =
  | { ok: true; name: string; command: string; args: string[]; env: Record<string, string> }
  | { ok: false; error: string };

/**
 * 解析并校验表单：名称非空且不含空白字符；新建时 command 必填（编辑留空 = 保持原值）；
 * env 行必须为 KEY=VALUE。出错时返回可直接展示的错误文案。
 */
export function parseMcpForm(
  input: McpFormInput,
  options: { commandRequired: boolean },
): McpFormParsed {
  const name = input.name.trim();
  if (!name) return { ok: false, error: '名称不能为空' };
  if (/\s/.test(name)) return { ok: false, error: '名称不能包含空格' };
  const command = input.command.trim();
  if (!command && options.commandRequired) return { ok: false, error: 'command 不能为空' };
  const { env, error } = parseEnvText(input.envText);
  if (error) return { ok: false, error };
  return { ok: true, name, command, args: parseArgsText(input.argsText), env };
}

export interface McpUpdatePatch {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** 编辑表单 → updateMcpServer 补丁：command/args/env 留空即不发送（保持原值）。 */
export function mcpUpdatePatch(parsed: {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}): McpUpdatePatch {
  const patch: McpUpdatePatch = { name: parsed.name };
  if (parsed.command) patch.command = parsed.command;
  if (parsed.args.length > 0) patch.args = parsed.args;
  if (Object.keys(parsed.env).length > 0) patch.env = parsed.env;
  return patch;
}

export interface McpStatusBadge {
  /** 徽标文案；connected 带工具数（未知时省略）。 */
  label: string;
  /** 状态点颜色；connecting 用旋转图标代替圆点。 */
  dotClass: string;
  spin: boolean;
}

export function mcpStatusBadge(
  status: McpConnectionStatus,
  toolCount: number | null,
): McpStatusBadge {
  switch (status) {
    case 'connecting':
      return { label: '连接中', dotClass: 'text-muted-foreground', spin: true };
    case 'connected':
      return {
        label: toolCount === null ? '已连接' : `已连接 · ${toolCount} 个工具`,
        dotClass: 'bg-success',
        spin: false,
      };
    case 'disconnected':
      return { label: '未连接', dotClass: 'bg-muted-foreground/40', spin: false };
    case 'error':
      return { label: '连接失败', dotClass: 'bg-destructive', spin: false };
  }
}
