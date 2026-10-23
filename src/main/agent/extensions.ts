// Pi 扩展运行时接入：会话打开后按 rpc 模式绑定扩展（触发 session_start、接上 ui 与命令上下文），
// 扩展报错推给界面并按包归档进设置页的诊断。命令、prompt 模板的执行与展开都由 Pi 自己完成，
// 这里只回答「这串输入是不是一条扩展命令或模板」，以及给输入框列出候选。
import type { AgentSession, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { ChatSlashCommand } from '../../shared/chat';
import { loadPi } from './pi';
import {
  createExtensionUi,
  emitExtensionUiEvent,
  releaseExtensionUi as releaseUi,
} from './extension-ui';
import { recordLoadDiagnostics } from './packages';

let themeReady = false;
/**
 * 扩展常读 ctx.ui.theme 拼终端配色。Pi 不导出全局 theme 实例，只把它挂在 globalThis 的
 * Symbol 上（让 node 与 jiti 两套模块实例共用），这里按同一个 key 读；第一次绑定前初始化。
 */
async function ensureTheme(): Promise<ExtensionUIContext['theme']> {
  if (!themeReady) {
    (await loadPi()).initTheme(undefined, false);
    themeReady = true;
  }
  const key = Symbol.for('@earendil-works/pi-coding-agent:theme');
  return new Proxy({} as ExtensionUIContext['theme'], {
    get: (_target, prop) =>
      (globalThis as unknown as Record<symbol, Record<PropertyKey, unknown>>)[key]?.[prop],
  });
}

/** 扩展文件路径 → 所属包来源；命令报错时 Pi 给的是 `command:<name>`，没有文件路径。 */
function sourceOf(session: AgentSession, extensionPath: string): string | null {
  const command = /^command:(.+)$/.exec(extensionPath)?.[1];
  const extensions = session.resourceLoader.getExtensions().extensions;
  if (command) {
    const found = session.extensionRunner
      .getRegisteredCommands()
      .find((item) => item.invocationName === command || item.name === command);
    return found?.sourceInfo.source ?? null;
  }
  return extensions.find((item) => item.path === extensionPath)?.sourceInfo.source ?? null;
}

function extensionLabel(path: string): string {
  const command = /^command:(.+)$/.exec(path)?.[1];
  if (command) return `/${command}`;
  return path.split(/[\\/]/).slice(-2).join('/');
}

export async function bindSessionExtensions(
  sessionId: string,
  session: AgentSession,
  hooks: { setTitle: (title: string) => void },
): Promise<void> {
  const loaded = session.resourceLoader.getExtensions();
  // 加载期就失败的扩展（语法错误、依赖缺失）不会进运行时，只在这里留下记录。
  const diagnostics = loaded.errors.map((error) => ({
    source:
      loaded.extensions.find((item) => item.path === error.path)?.sourceInfo.source ?? error.path,
    message: `${extensionLabel(error.path)}：${error.error}`,
  }));
  for (const error of loaded.errors)
    emitExtensionUiEvent({
      type: 'error',
      sessionId,
      extension: extensionLabel(error.path),
      message: error.error,
    });
  const theme = await ensureTheme();
  await session.bindExtensions({
    mode: 'rpc',
    uiContext: createExtensionUi(sessionId, theme, hooks.setTitle),
    // 与 Pi rpc 模式相同：会话替换类动作（新会话、切换、分叉）在 Dela 里由会话列表负责，
    // 扩展发起时返回 cancelled，不在 Dela 不知情的情况下换掉 Pi 会话文件。
    commandContextActions: {
      waitForIdle: () => session.agent.waitForIdle(),
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      switchSession: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await session.navigateTree(targetId, {
          summarize: options?.summarize,
          customInstructions: options?.customInstructions,
          replaceInstructions: options?.replaceInstructions,
          label: options?.label,
        });
        return { cancelled: result.cancelled };
      },
      reload: () => session.reload(),
    },
    onError: (error) => {
      const source = sourceOf(session, error.extensionPath);
      if (source)
        diagnostics.push({
          source,
          message: `${extensionLabel(error.extensionPath)}（${error.event}）：${error.error}`,
        });
      recordLoadDiagnostics(diagnostics);
      emitExtensionUiEvent({
        type: 'error',
        sessionId,
        extension: extensionLabel(error.extensionPath),
        message: error.error,
      });
    },
  });
  recordLoadDiagnostics(diagnostics);
}

/**
 * 结束一个会话实例。AgentSession.dispose 不发 session_shutdown（Pi 由 AgentSessionRuntime 在
 * dispose 前发），Dela 直接持有 AgentSession，所以在这里补发：扩展靠它关掉子进程、监听器与连接
 * （包注册的 MCP 服务器就在其中）。reload 表示按新配置重建，quit 表示会话被删除或应用退出。
 */
export async function shutdownSession(
  session: AgentSession,
  reason: 'quit' | 'reload',
): Promise<void> {
  try {
    if (session.extensionRunner.hasHandlers('session_shutdown'))
      await session.extensionRunner.emit({ type: 'session_shutdown', reason });
  } finally {
    session.dispose();
  }
}

export function releaseExtensionUi(sessionId: string) {
  releaseUi(sessionId);
}

const commandName = (text: string) => /^\/([^\s]+)/.exec(text)?.[1];

/** 输入是不是扩展命令或 prompt 模板（Pi 只认开头的 `/name`）。 */
export function extensionCommand(session: AgentSession, text: string): boolean {
  const name = commandName(text);
  if (!name) return false;
  return (
    session.extensionRunner.getCommand(name) !== undefined ||
    session.promptTemplates.some((template) => template.name === name)
  );
}

/** 输入框 `/` 候选：扩展命令与 prompt 模板，标出所属包。 */
export function sessionSlashCommands(session: AgentSession): ChatSlashCommand[] {
  const label = (source: string) => source.split(/[\\/]/).pop()?.replace(/^npm:/, '') ?? source;
  return [
    ...session.extensionRunner.getRegisteredCommands().map((command) => ({
      name: command.invocationName,
      description: command.description ?? '',
      kind: 'extension' as const,
      source: label(command.sourceInfo.source),
    })),
    ...session.promptTemplates
      .filter((template) => template.sourceInfo.origin === 'package')
      .map((template) => ({
        name: template.name,
        description: template.description,
        kind: 'prompt' as const,
        source: label(template.sourceInfo.source),
        ...(template.argumentHint ? { argumentHint: template.argumentHint } : {}),
      })),
  ];
}
