// 测试用扩展：覆盖工具、命令、session_start 与对话框往返、可见消息、状态栏与 TUI 专属接口。
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { shout } from '../lib/shout';

export default function (pi: ExtensionAPI) {
  // 测试经环境变量给出一个 stdio MCP 服务器：验证包注册的 MCP 服务器能连上、工具可调用。
  const mcpServer = process.env.DELA_FIXTURE_MCP_SERVER;
  if (mcpServer)
    pi.registerMcpServer('fixture-echo', {
      command: process.execPath,
      args: [mcpServer],
      exposure: 'direct',
    });
  pi.registerTool({
    name: 'fixture_echo',
    label: 'fixture_echo',
    description: 'Echo the input in upper case.',
    parameters: Type.Object({ text: Type.String() }),
    async execute(_id, params) {
      return { content: [{ type: 'text', text: shout(params.text) }], details: undefined };
    },
  });
  pi.registerCommand('fixture-ask', {
    description: 'Ask the user to pick a color',
    handler: async (args, ctx) => {
      const color = await ctx.ui.select(`Pick a color for ${args}`, ['red', 'blue']);
      const sure = await ctx.ui.confirm('Sure?', `You picked ${color}`);
      pi.sendMessage({ customType: 'fixture', content: `picked ${color} ${sure}`, display: true });
      pi.appendEntry('fixture-state', { color });
      ctx.ui.setStatus('fixture', `color: ${color}`);
    },
  });
  pi.registerCommand('fixture-fail', {
    description: 'Always throws',
    handler: async () => {
      throw new Error('fixture command failed');
    },
  });
  pi.on('session_shutdown', (event) => {
    const shutdowns = ((globalThis as Record<string, unknown>).__delaFixtureShutdowns ??=
      []) as string[];
    shutdowns.push(event.reason);
  });
  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.notify(`fixture started in ${ctx.mode}`, 'info');
    ctx.ui.setWidget('fixture', ['line one', 'line two']);
    ctx.ui.setFooter(() => ({ render: () => [], invalidate: () => {} }));
    ctx.ui.theme.fg('accent', 'themed');
    pi.sendMessage({ customType: 'fixture-hidden', content: 'model only', display: false });
  });
}
