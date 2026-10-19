// 用本地 echo 服务器（stdio JSON-RPC，无网络）走真实 database.ts（electron app.getPath
// 指向临时目录），覆盖 MCP 连接、工具发现、断连与配置持久化。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
import { closeDatabase, getDatabase } from '../../database';
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

const echoServer = fileURLToPath(new URL('./echo-server.ts', import.meta.url));
const echoConfig = { name: 'echo-srv', command: process.execPath, args: [echoServer], env: {} };

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
  getDatabase();
});

afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const view of listMcpServers()) await removeMcpServer(view.id);
  getDatabase().prepare("DELETE FROM workspace_settings WHERE key='mcp-servers'").run();
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

  it('不可用边界：未知名/未提供工具/非对象参数', async () => {
    await addMcpServer(echoConfig);
    await expect(executeMcpTool('mcp_missing_x', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: expect.stringContaining('不可用或不存在') },
    });
    await expect(executeMcpTool('mcp_echo_srv_nope', {})).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'NOT_CONFIGURED',
        message: expect.stringContaining('未提供工具 mcp_echo_srv_nope'),
      },
    });
    await expect(executeMcpTool('mcp_echo_srv_echo', ['not-object'])).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
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

  it('spawn 失败：error 视图携带原因', async () => {
    const views = await addMcpServer({
      name: 'broken',
      command: 'dela-definitely-missing-command',
      args: [],
      env: {},
    });
    expect(views[0]).toMatchObject({ status: 'error', toolCount: null });
    expect(views[0]!.error).toBeTruthy();
    expect(mcpToolDefinitions()).toHaveLength(0);
  }, 20000);

  it('同名（归一化后）服务器：后续工具全部跳过并在 error 注明', async () => {
    await addMcpServer({ ...echoConfig, name: 'a-b' });
    const views = await addMcpServer({ ...echoConfig, name: 'a_b' });
    const second = views.find((view) => view.name === 'a_b')!;
    expect(second).toMatchObject({ status: 'connected', toolCount: 3 });
    expect(second.error).toContain('已跳过');
    expect(mcpToolDefinitions()).toHaveLength(3);
  }, 30000);

  it('归一化同名冲突（服务器 a 的 b_x 与服务器 a-b 的 x）：路由按 adopt 登记执行，不猜最长前缀', async () => {
    // 服务器 a 的 echo 工具经 DELA_TOOL_NAME 改名为 b_echo：归一化名 mcp_a_b_echo
    // 与服务器 a-b 的 echo（mcp_a_b_echo）同名——先到者 a 收纳并登记路由，a-b 跳过。
    await addMcpServer({ ...echoConfig, name: 'a', env: { DELA_TOOL_NAME: 'b_echo' } });
    const views = await addMcpServer({ ...echoConfig, name: 'a-b' });
    expect(views.find((view) => view.name === 'a-b')!.error).toContain('已跳过');
    expect(mcpToolDefinitions()).toHaveLength(5);
    // 最长前缀（mcp_a_b 长于 mcp_a）会把 mcp_a_b_echo 误配给 a-b 导致不可调用；
    // 按登记路由应回到真正归属的服务器 a 并完成往返。
    await expect(executeMcpTool('mcp_a_b_echo', { message: '你好' })).resolves.toMatchObject({
      ok: true,
      result: { text: 'echo:你好' },
    });
    await expect(executeMcpTool('mcp_a_b_fail', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPSTREAM_ERROR' },
    });
  }, 30000);

  it('重名服务器直接拒绝', async () => {
    await addMcpServer(echoConfig);
    await expect(addMcpServer(echoConfig)).rejects.toThrow('已有同名服务器');
  }, 20000);
});

describe('MCP 配置管理与持久化', () => {
  it('update 禁用即断开、重新启用重连；配置持久化于 workspace_settings', async () => {
    const [created] = await addMcpServer(echoConfig);
    const row = getDatabase()
      .prepare("SELECT value FROM workspace_settings WHERE key='mcp-servers'")
      .get() as { value: string };
    const stored = JSON.parse(row.value) as { id: string; name: string; enabled: boolean }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: created!.id, name: 'echo-srv', enabled: true });
    // patch 先经 IPC 同款 zod 校验：仅启停不得改写 args/env（zod partial 默认值陷阱回归）。
    const disabled = await updateMcpServer(
      created!.id,
      mcpServerPatchSchema.parse({ enabled: false }),
    );
    expect(disabled[0]).toMatchObject({ enabled: false, status: 'disconnected', toolCount: null });
    expect(
      (
        JSON.parse(
          (
            getDatabase()
              .prepare("SELECT value FROM workspace_settings WHERE key='mcp-servers'")
              .get() as { value: string }
          ).value,
        ) as { args: string[]; env: Record<string, string> }[]
      )[0]!,
    ).toMatchObject({ args: [echoServer], env: {} });
    expect(mcpToolDefinitions()).toHaveLength(0);
    await expect(executeMcpTool('mcp_echo_srv_echo', { message: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: expect.stringContaining('echo-srv') },
    });
    const enabled = await updateMcpServer(created!.id, { enabled: true });
    expect(enabled[0]).toMatchObject({ status: 'connected', toolCount: 3 });
  }, 30000);

  it('未知名抛错；remove 后从视图与持久化中消失', async () => {
    await expect(updateMcpServer('11111111-1111-4111-8111-111111111111', {})).rejects.toThrow(
      'MCP 服务器不存在',
    );
    await expect(refreshMcpServer('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      'MCP 服务器不存在',
    );
    const [created] = await addMcpServer(echoConfig);
    const views = await removeMcpServer(created!.id);
    expect(views).toHaveLength(0);
    const row = getDatabase()
      .prepare("SELECT value FROM workspace_settings WHERE key='mcp-servers'")
      .get() as { value: string } | undefined;
    expect(JSON.parse(row?.value ?? '[]')).toHaveLength(0);
    await expect(removeMcpServer(created!.id)).rejects.toThrow('MCP 服务器不存在');
  }, 20000);
});
