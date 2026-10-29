import type { AgentTool } from '../domain/shared';
import type { FlagSpec } from './flags';
import { flagsFromSchema, formatHelp, parseArgv } from './flags';

export type DomainEntry = { description: string; commands: Record<string, AgentTool> };

export type CliResult = { status: number; body: string };

export type CliDeps = {
  domains: Record<string, DomainEntry>;
  execute: (name: string, input: unknown) => Promise<unknown>;
};

const flagCache = new Map<string, FlagSpec[]>();

function flagsOf(name: string, command: AgentTool) {
  const cached = flagCache.get(name);
  if (cached) return cached;
  const flags = flagsFromSchema(command.schema);
  flagCache.set(name, flags);
  return flags;
}

const text = (body: string): CliResult => ({ status: 200, body });
const fail = (error: string, status = 400): CliResult => ({
  status,
  body: JSON.stringify({ ok: false, error }),
});

function commandIndex(domains: Record<string, DomainEntry>) {
  const index = new Map<string, { domain: string; name: string; tool: AgentTool }>();
  for (const [domain, entry] of Object.entries(domains))
    for (const [name, tool] of Object.entries(entry.commands))
      index.set(name, { domain, name, tool });
  return index;
}

function overview(domains: Record<string, DomainEntry>) {
  const lines = ['用法：dela <域> <命令> [参数]', ''];
  for (const [domain, entry] of Object.entries(domains)) {
    lines.push(`${domain}  ${entry.description}`);
    for (const [name, tool] of Object.entries(entry.commands))
      lines.push(`  ${name.padEnd(28)}${tool.description.split('。')[0]}`);
  }
  lines.push('', '单条命令的参数用 dela <域> <命令> --help 查看。');
  return lines.join('\n');
}

/** 解析 `dela <域> <命令> [--flag 值]`；只接受 NUL 分隔后的参数数组。 */
export async function runCli(argv: string[], deps: CliDeps): Promise<CliResult> {
  // dela help 与 dela <域> <命令> --help 都落到帮助文本，旧写法的 JSON Schema 列表仍在 JSON 通道里。
  const wantsHelp = ['help', '--help', '-h'].includes(argv[0] ?? '');
  const [first, second, ...rest] = wantsHelp ? argv.slice(1) : argv;
  const index = commandIndex(deps.domains);
  if (!first) return text(overview(deps.domains));

  const inDomain = deps.domains[first];
  if (inDomain && !second) {
    const usage = Object.entries(inDomain.commands)
      .map(([name, tool]) => `  dela ${first} ${name}\n      ${tool.description}`)
      .join('\n');
    return text(`${first}：${inDomain.description}\n\n${usage}`);
  }

  const resolved = inDomain
    ? { domain: first, name: second!, tool: inDomain.commands[second!] }
    : index.get(first);
  if (!resolved?.tool)
    return fail(`命令不存在：${argv.slice(0, 2).join(' ')}；可用 dela help 查看全部命令`, 404);

  const { domain, name, tool } = resolved;
  const flags = flagsOf(name, tool);
  if (wantsHelp || rest.includes('--help') || rest.includes('-h'))
    return text(formatHelp(`${domain} ${name}`, tool.description, flags));

  const parsed = parseArgv(rest, flags);
  if (!parsed.ok) return fail(parsed.error);

  try {
    const result = await deps.execute(name, parsed.input);
    return text(JSON.stringify({ ok: true, result }));
  } catch (error) {
    return fail(error instanceof Error ? error.message : '命令失败', 500);
  }
}

/** 从 stdin 读到的 NUL 分隔参数还原成数组，尾部空串来自结尾的 NUL。 */
export function splitArgv(body: Buffer) {
  const parts = body.toString('utf8').split('\0');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}
