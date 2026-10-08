import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { canvasTools } from './domain/canvas';
import { mailTools } from './domain/mail';
import { shuiyuanTools } from './domain/shuiyuan';
import { timetableTools } from './domain/timetable';
import { todoTools } from './domain/todo';
import { workspaceTools } from './domain/workspace';
import { readResourceTool } from './domain/read-resource';
import type { AgentTool } from './domain/shared';

// 这些是 shell 的业务命令，不常驻模型工具表；复用应用已有的缓存、登录与操作边界。
export const commandDomains = [
  { name: 'canvas', description: '查询、同步 Canvas 课程与资料', commands: canvasTools },
  { name: 'mail', description: '检索邮件、读取附件与准备邮件草稿', commands: mailTools },
  { name: 'shuiyuan', description: '查看水源分类、话题、搜索与帖子内容', commands: shuiyuanTools },
  {
    name: 'timetable',
    description: '查询课表与日程，同步课表、创建或删除日程',
    commands: timetableTools,
  },
  { name: 'todo', description: '查询与管理待办、Canvas 作业', commands: todoTools },
  {
    name: 'workspace',
    description: '管理项目、关联校园资料与导入附件；普通文件用 read/write/edit/shell',
    commands: workspaceTools,
  },
] as const;

const commands: Record<string, AgentTool> = Object.assign(
  { read_resource: readResourceTool },
  ...commandDomains.map((domain) => domain.commands),
);

export async function executeDomainCommand(name: string, input: unknown) {
  if (name === 'help') {
    const selected =
      typeof input === 'object' && input !== null && 'command' in input
        ? String(input.command)
        : '';
    return Object.entries(commands)
      .filter(([name]) => !selected || name === selected)
      .map(([name, command]) => ({
        name,
        description: command.description,
        parameters: z.toJSONSchema(command.schema, { io: 'input' }),
      }));
  }
  if (!Object.hasOwn(commands, name)) throw new Error(`命令不存在：${name}，请使用 dela help`);
  return commands[name]!.execute(input);
}

/** 本机命令桥（127.0.0.1 随机端口 + Bearer token）：token 只进入 agent 与终端的子进程环境，不含业务凭据。 */
export async function startDomainBridge() {
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (
      request.method !== 'POST' ||
      request.url !== '/' ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response.writeHead(403).end(JSON.stringify({ ok: false, error: '请求不可用' }));
      return;
    }
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 2_000_000) throw new Error('命令输入过大');
      }
      const parsed = z
        .object({ command: z.string().min(1), input: z.unknown().default({}) })
        .strict()
        .parse(JSON.parse(body));
      const result = await executeDomainCommand(parsed.command, parsed.input);
      response.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      response.end(
        JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '命令失败' }),
      );
    }
  });
  let address = await listen(server);
  // Node fetch（undici）拒绝连接知名服务端口（69、137 等），随机端口偶尔会落入其中。
  for (let attempt = 0; isBlockedPort(address.port) && attempt < 5; attempt++) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    address = await listen(server);
  }
  if (isBlockedPort(address.port)) {
    server.closeAllConnections();
    server.close();
    throw new Error('命令桥未能避开受限端口');
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    token,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<{ address: string; port: number }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const bound = server.address();
      if (!bound || typeof bound === 'string') {
        server.close();
        reject(new Error('命令桥启动失败'));
        return;
      }
      resolve(bound);
    });
  });
}

/** WHATWG Fetch 规范的 bad-IPv4-port 列表（Node fetch 同步拒绝连接这些端口）。 */
const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 545, 543, 544, 548, 554, 556, 563, 587, 601, 636,
  989, 990, 991, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
]);
const isBlockedPort = (port: number) => BLOCKED_PORTS.has(port);

export const COMMAND_BRIDGE = `dela() {
  command_name="$1"
  command_json="\${2:-{}}"
  curl --silent --show-error --fail-with-body -H "Authorization: Bearer $DELA_COMMAND_TOKEN" -H 'Content-Type: application/json' --data "{\\"command\\":\\"$command_name\\",\\"input\\":$command_json}" "$DELA_COMMAND_URL"
}`;
