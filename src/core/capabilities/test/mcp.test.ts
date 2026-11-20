// 用本地 echo 服务器（stdio JSON-RPC）与环回 HTTP 服务器走真实的 ~/.dela/mcp.json，
// 覆盖 MCP 连接、工具发现、断连与配置持久化。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const state = vi.hoisted(() => ({ root: '' }));
import {
  addMcpServer,
  executeMcpTool,
  listMcpServers,
  mcpServerPatchSchema,
  mcpToolDefinitions,
  refreshMcpServer,
  removeMcpServer,
  updateMcpServer,
} from '../mcp';
import { configFilePath } from '../../config-files';
import { provideTestHostPorts } from '../../test/host-mock';

const echoServer = fileURLToPath(new URL('./echo-server.ts', import.meta.url));
const echoConfig = {
  name: 'echo-srv',
  transport: 'stdio' as const,
  command: process.execPath,
  args: [echoServer],
  env: {},
};
const storedConfigs = () =>
  JSON.parse(readFileSync(configFilePath('mcp.json'), 'utf8')).mcpServers as Record<
    string,
    Record<string, unknown>
  >;

async function until(assertion: () => void, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-mcp-'));
  provideTestHostPorts({ paths: { userData: () => state.root, home: () => state.root } });
});

afterAll(() => {
  rmSync(state.root, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const view of listMcpServers()) await removeMcpServer(view.id);
});

describe('MCP 连接与工具发现', () => {
  it('add 即连接：connected 视图、工具计数与命名空间定义', async () => {
    const views = await addMcpServer(echoConfig);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      name: 'echo-srv',
      enabled: true,
      status: 'connected',
      toolCount: 3,
      error: null,
    });
    const definitions = mcpToolDefinitions();
    expect(definitions.map(({ function: fn }) => fn.name).sort()).toEqual([
      'mcp_echo_srv_die',
      'mcp_echo_srv_echo',
      'mcp_echo_srv_fail',
    ]);
    const echo = definitions.find(({ function: fn }) => fn.name === 'mcp_echo_srv_echo')!;
    expect(echo.function.description).toContain('[MCP echo-srv]');
    expect(echo.function.description).toContain('资料参考');
    expect((echo.function.parameters as { type: string }).type).toBe('object');
  }, 20000);

  it('callTool 往返：文本与 structured 内容；服务器 isError 映射为失败结果', async () => {
    await addMcpServer(echoConfig);
    await expect(executeMcpTool('mcp_echo_srv_echo', { message: '你好' })).resolves.toMatchObject({
      ok: true,
      result: { text: 'echo:你好', structured: { echoed: true } },
    });
    await expect(executeMcpTool('mcp_echo_srv_fail', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: '服务器内部失败' },
    });
  }, 20000);

  it('服务器进程退出：断连标 error、工具集清空，refresh 恢复', async () => {
    const [view] = await addMcpServer(echoConfig);
    await expect(executeMcpTool('mcp_echo_srv_die', {})).resolves.toMatchObject({ ok: true });
    await until(() => {
      const current = listMcpServers().find((item) => item.id === view!.id)!;
      expect(current).toMatchObject({ status: 'error', toolCount: null });
      expect(current.error).toContain('连接已断开');
    });
    expect(mcpToolDefinitions()).toHaveLength(0);
    await expect(executeMcpTool('mcp_echo_srv_echo', { message: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: expect.stringContaining('当前不可用') },
    });
    const refreshed = await refreshMcpServer(view!.id);
    expect(refreshed[0]).toMatchObject({ status: 'connected', toolCount: 3, error: null });
  }, 20000);

  // 工具名归一化后冲突时按登记路由到先到的服务器，不猜最长前缀。
  it('归一化同名冲突：路由按登记执行', async () => {
    await addMcpServer({ ...echoConfig, name: 'a', env: { DELA_TOOL_NAME: 'b_echo' } });
    const views = await addMcpServer({ ...echoConfig, name: 'a-b' });
    expect(views.find((view) => view.name === 'a-b')!.error).toContain('已跳过');
    expect(mcpToolDefinitions()).toHaveLength(5);
    await expect(executeMcpTool('mcp_a_b_echo', { message: '你好' })).resolves.toMatchObject({
      ok: true,
      result: { text: 'echo:你好' },
    });
    await expect(executeMcpTool('mcp_a_b_fail', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPSTREAM_ERROR' },
    });
  }, 30000);
});

describe('MCP 配置管理与持久化', () => {
  it('update 禁用即断开、重新启用重连；配置持久化于 mcp.json', async () => {
    const [created] = await addMcpServer(echoConfig);
    expect(Object.keys(storedConfigs())).toEqual(['echo-srv']);
    expect(storedConfigs()['echo-srv']).not.toHaveProperty('disabled');
    const disabled = await updateMcpServer(
      created!.id,
      mcpServerPatchSchema.parse({ enabled: false }),
    );
    expect(disabled[0]).toMatchObject({ enabled: false, status: 'disconnected', toolCount: null });
    expect(storedConfigs()['echo-srv']).toMatchObject({
      args: [echoServer],
      env: {},
      disabled: true,
    });
    expect(mcpToolDefinitions()).toHaveLength(0);
    await expect(executeMcpTool('mcp_echo_srv_echo', { message: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: expect.stringContaining('echo-srv') },
    });
    const enabled = await updateMcpServer(created!.id, { enabled: true });
    expect(enabled[0]).toMatchObject({ status: 'connected', toolCount: 3 });
  }, 30000);

  it('读入手写的服务器；改名时保留 Dela 不认识的字段', async () => {
    writeFileSync(
      configFilePath('mcp.json'),
      JSON.stringify({
        mcpServers: {
          hand: { command: echoConfig.command, args: echoConfig.args, owner: 'magpie' },
        },
      }),
    );
    expect(listMcpServers()).toMatchObject([{ id: 'hand', name: 'hand', transport: 'stdio' }]);
    await updateMcpServer('hand', mcpServerPatchSchema.parse({ name: 'renamed', enabled: false }));
    expect(storedConfigs()).toEqual({
      renamed: {
        owner: 'magpie',
        command: echoConfig.command,
        args: echoConfig.args,
        env: {},
        disabled: true,
      },
    });
  }, 30000);
});

describe('Streamable HTTP', () => {
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer t') {
      response.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const message = JSON.parse(body) as {
        id?: number;
        method: string;
        params?: { arguments?: { message?: string } };
      };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'h', version: '1' },
            }
          : message.method === 'tools/list'
            ? { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }
            : {
                content: [
                  { type: 'text', text: `http:${message.params?.arguments?.message ?? ''}` },
                ],
              };
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  let url = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('带请求头连接、发现并调用工具；请求头不进视图', async () => {
    const [view] = await addMcpServer({
      name: 'remote',
      transport: 'http',
      url,
      headers: { Authorization: 'Bearer t' },
    });
    expect(view).toMatchObject({ transport: 'http', status: 'connected', toolCount: 1 });
    expect(JSON.stringify(view)).not.toContain('Bearer');
    await expect(executeMcpTool('mcp_remote_echo', { message: 'hi' })).resolves.toMatchObject({
      ok: true,
      result: { text: 'http:hi' },
    });
    expect(storedConfigs().remote).toMatchObject({
      type: 'http',
      headers: { Authorization: 'Bearer t' },
    });
  }, 20000);
});
