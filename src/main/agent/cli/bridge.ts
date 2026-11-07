import type { AgentTool } from '../domain/shared';
import type { FlagSpec, ParseResult } from './flags';
import { flagsFromSchema, formatHelp, parseArgv } from './flags';

export type DomainEntry = { description: string; commands: Record<string, AgentTool> };

export type CliResult = { status: number; body: string };

export type CliDeps = {
  domains: Record<string, DomainEntry>;
  /** 关掉的功能不列进 help（执行时另有开关检查）。 */
  visible?: (domain: string) => boolean;
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

/** 旧的 dela <命令> '<JSON>' 写法：第二个参数是一段 JSON。 */
function legacyInput(raw: string): ParseResult {
  try {
    return { ok: true, input: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { ok: false, error: `参数需要合法 JSON，收到 ${raw}` };
  }
}

function commandIndex(domains: Record<string, DomainEntry>) {
  const index = new Map<string, { domain: string; name: string; tool: AgentTool }>();
  for (const [domain, entry] of Object.entries(domains))
    for (const [name, tool] of Object.entries(entry.commands))
      index.set(name, { domain, name, tool });
  return index;
}

const listedDomains = (deps: CliDeps) =>
  Object.entries(deps.domains).filter(([domain]) => deps.visible?.(domain) ?? true);

function overview(deps: CliDeps) {
  const lines = ['用法：dela <域> <命令> [参数]', ''];
  for (const [domain, entry] of listedDomains(deps)) {
    lines.push(`${domain}  ${entry.description}`);
    for (const [name, tool] of Object.entries(entry.commands))
      lines.push(`  ${name.padEnd(28)}${tool.description.split('。')[0]}`);
  }
  lines.push('', '单条命令的参数用 dela <域> <命令> --help 查看。');
  return lines.join('\n');
}

/** 解析 `dela <域> <命令> [--flag 值]`，以及旧的 `dela <命令> '<JSON>'`；只接受 NUL 分隔后的参数数组。 */
export async function runCli(argv: string[], deps: CliDeps): Promise<CliResult> {
  // dela help 与 dela <域> <命令> --help 都落到帮助文本。
  const wantsHelp = ['help', '--help', '-h'].includes(argv[0] ?? '');
  const tokens = wantsHelp ? argv.slice(1) : argv;
  const [first, second, ...tail] = tokens;
  const index = commandIndex(deps.domains);
  if (!first) return text(overview(deps));

  const inDomain = deps.visible?.(first) === false ? undefined : deps.domains[first];
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
  // 带域时命令名占掉了第二个参数，不带域时它属于参数本身。
  const args = inDomain ? tail : tokens.slice(1);
  const flags = flagsOf(name, tool);
  if (wantsHelp || args.includes('--help') || args.includes('-h'))
    return text(formatHelp(`${domain} ${name}`, tool.description, flags));

  const parsed =
    !inDomain && args.length === 1 && args[0]!.startsWith('{')
      ? legacyInput(args[0]!)
      : parseArgv(args, flags);
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
