// 测试用最小 MCP echo 服务器（stdio：按行分隔的 JSON-RPC，无任何外部依赖）。
// 工具：echo（正常往返）、fail（isError 结果）、die（应答后退出进程，模拟服务器崩溃）。
// DELA_TOOL_NAME 可重命名 echo 工具（构造归一化同名冲突场景），缺省 'echo'。
import process from 'node:process';

const echoToolName = process.env.DELA_TOOL_NAME ?? 'echo';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> };
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: echoToolName,
    description: '回显消息',
    inputSchema: {
      type: 'object',
      properties: { message: 'string' },
      required: ['message'],
    },
  },
  {
    name: 'fail',
    description: '返回 isError 结果',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'die',
    description: '应答后退出进程',
    inputSchema: { type: 'object', properties: {} },
  },
];

function write(message: JsonRpcResponse) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo', version: '1.0.0' },
      },
    });
    return;
  }
  if (message.id === undefined) return; // 通知（notifications/initialized 等）无需应答
  if (message.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
    return;
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (name === echoToolName) {
      write({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: `echo:${args.message ?? ''}` }],
          structuredContent: { echoed: true },
        },
      });
    } else if (name === 'fail') {
      write({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: '服务器内部失败' }], isError: true },
      });
    } else if (name === 'die') {
      write({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: 'bye' }] },
      });
      setTimeout(() => process.exit(0), 20);
    } else {
      write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `unknown tool ${name}` },
      });
    }
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try {
        handle(JSON.parse(line) as JsonRpcRequest);
      } catch {
        // 畸形行忽略：测试服务器只服务最小握手
      }
    }
    newline = buffer.indexOf('\n');
  }
});
process.stdin.on('end', () => process.exit(0));
