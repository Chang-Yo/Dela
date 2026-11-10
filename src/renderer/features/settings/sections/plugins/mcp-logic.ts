// MCP 页签的可测纯逻辑：参数与键值文本解析、表单校验、编辑补丁与状态徽标映射。
// 视图不携带命令、地址与密钥，编辑表单因此采用"留空保持原值"的部分补丁。
import type {
  McpConnectionStatus,
  McpServerInput,
  McpServerPatch,
  McpTransportConfig,
} from '../../../../../shared/capabilities';

export function parseArgsText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const pairFormats = {
  '=': { label: '环境变量', format: 'KEY=VALUE' },
  ':': { label: '请求头', format: 'Name: value' },
};

/** 每行一条键值（值可为空，以第一个分隔符切开）；格式错误时返回带行号的错误。 */
export function parsePairs(
  text: string,
  separator: keyof typeof pairFormats,
): { pairs: Record<string, string>; error: string | null } {
  const pairs: Record<string, string> = {};
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line) continue;
    const at = line.indexOf(separator);
    const key = at < 0 ? '' : line.slice(0, at).trim();
    if (!key) {
      const { label, format } = pairFormats[separator];
      return { pairs, error: `${label}第 ${index + 1} 行应为 ${format} 格式` };
    }
    pairs[key] = line.slice(at + 1).trim();
  }
  return { pairs, error: null };
}

export interface McpFormInput {
  transport: McpTransportConfig['transport'];
  name: string;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
}

export type McpFormParsed = { ok: true; value: McpServerInput } | { ok: false; error: string };

/**
 * 解析并校验表单：名称非空且不含空白字符；新建时 command 或地址必填（编辑留空 = 保持原值）；
 * 键值行格式错误时返回可直接展示的错误文案。
 */
export function parseMcpForm(input: McpFormInput, options: { isEdit: boolean }): McpFormParsed {
  const name = input.name.trim();
  if (!name) return { ok: false, error: '名称不能为空' };
  if (/\s/.test(name)) return { ok: false, error: '名称不能包含空格' };
  if (input.transport === 'http') {
    const url = input.url.trim();
    if (!url && !options.isEdit) return { ok: false, error: '地址不能为空' };
    if (url && !/^https?:$/.test(URL.parse(url)?.protocol ?? ''))
      return { ok: false, error: '地址需以 http:// 或 https:// 开头' };
    const { pairs, error } = parsePairs(input.headersText, ':');
    if (error) return { ok: false, error };
    return { ok: true, value: { transport: 'http', name, url, headers: pairs } };
  }
  const command = input.command.trim();
  if (!command && !options.isEdit) return { ok: false, error: 'command 不能为空' };
  const { pairs, error } = parsePairs(input.envText, '=');
  if (error) return { ok: false, error };
  return {
    ok: true,
    value: { transport: 'stdio', name, command, args: parseArgsText(input.argsText), env: pairs },
  };
}

/** 编辑表单 → updateMcpServer 补丁：留空的连接字段不发送（保持原值）。 */
export function mcpUpdatePatch(value: McpServerInput): McpServerPatch {
  const patch: McpServerPatch = { name: value.name };
  if (value.transport === 'http') {
    if (value.url) patch.url = value.url;
    if (Object.keys(value.headers).length > 0) patch.headers = value.headers;
    return patch;
  }
  if (value.command) patch.command = value.command;
  if (value.args.length > 0) patch.args = value.args;
  if (Object.keys(value.env).length > 0) patch.env = value.env;
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
