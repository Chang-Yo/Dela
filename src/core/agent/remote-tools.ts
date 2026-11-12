/**
 * 远程工具：把 Pi 七个内置工具的执行端换到 RemoteBackend。read/write/edit/bash/ls/find 复用 Pi 的定义、
 * 只注入 operations；grep 在 Pi 内固定 spawn 本地 rg，故保留其 schema 与描述、自写 execute。
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { RemoteBackend } from '../remote/operations';
import { loadPi } from './pi';

/** 单行匹配文本上限（与 Pi 的 grep 一致）。 */
const GREP_MAX_LINE_LENGTH = 500;

/** Pi 的工具定义在参数类型上是不变的，customTools 收的却是 ToolDefinition[]：
 *  这里是纯类型收窄，运行时对象原样传递。 */
const asTool = (definition: unknown): ToolDefinition => definition as ToolDefinition;

/** 远端 grep：输出格式照 Pi 的 grep。Pi 的 grep 工具没有 operations 注入点，
 *  所以这里保留它的 schema 与描述、只换 execute。 */
export async function remoteGrepTool(cwd: string, backend: RemoteBackend): Promise<ToolDefinition> {
  const pi = await loadPi();
  const base = pi.createGrepToolDefinition(cwd);
  return asTool({
    ...base,
    execute: async (_toolCallId: string, rawParams: unknown, signal?: AbortSignal) => {
      const params = rawParams as {
        pattern: string;
        path?: string;
        glob?: string;
        ignoreCase?: boolean;
        literal?: boolean;
        context?: number;
        limit?: number;
      };
      const result = await backend.search(
        {
          path: params.path && params.path !== '.' ? params.path : cwd,
          pattern: params.pattern,
          glob: params.glob,
          ignoreCase: params.ignoreCase,
          literal: params.literal,
          context: params.context ? Math.max(1, Math.min(params.context, 20)) : 0,
          limit: Math.min(Math.max(params.limit ?? 100, 1), 500),
        },
        signal,
      );
      if (!result.matches.length)
        return {
          content: [{ type: 'text' as const, text: 'No matches found' }],
          details: undefined,
        };
      const output: string[] = [];
      let previous: { path: string; line: number } | null = null;
      for (const match of result.matches) {
        const before = (match.context ?? []).filter((line) => line.line < match.line);
        const after = (match.context ?? []).filter((line) => line.line > match.line);
        const first = before[0]?.line ?? match.line;
        // 与 rg 的分组一致：同一文件里不相邻的两段之间用 -- 隔开。
        if (previous && (previous.path !== match.path || first > previous.line + 1))
          output.push('--');
        for (const line of before) output.push(`${match.path}-${line.line}- ${line.text}`);
        output.push(
          `${match.path}:${match.line}: ${pi.truncateLine(match.text, GREP_MAX_LINE_LENGTH).text}`,
        );
        for (const line of after) output.push(`${match.path}-${line.line}- ${line.text}`);
        previous = { path: match.path, line: after.at(-1)?.line ?? match.line };
      }
      const truncated = pi.truncateHead(output.join('\n'), {
        maxLines: pi.DEFAULT_MAX_LINES,
        maxBytes: pi.DEFAULT_MAX_BYTES,
      });
      const cut = truncated.truncated || result.truncated;
      const text = cut ? `${truncated.content}\n\n[输出已截断]` : truncated.content;
      return { content: [{ type: 'text' as const, text }], details: undefined };
    },
  });
}

/** 七个工具的远程版本：名字与内置完全一致，Pi 按名字覆盖内置定义。 */
export async function remoteTools(cwd: string, backend: RemoteBackend): Promise<ToolDefinition[]> {
  // Pi 是纯 ESM：主进程 CJS 产物只能动态 import，不能在文件顶部静态引入。
  const pi = await loadPi();
  return [
    pi.createReadToolDefinition(cwd, { operations: backend.read }),
    pi.createWriteToolDefinition(cwd, { operations: backend.write }),
    pi.createEditToolDefinition(cwd, { operations: backend.edit }),
    pi.createBashToolDefinition(cwd, { operations: backend.bash }),
    pi.createLsToolDefinition(cwd, { operations: backend.ls }),
    pi.createFindToolDefinition(cwd, { operations: backend.find }),
    await remoteGrepTool(cwd, backend),
  ].map(asTool);
}
