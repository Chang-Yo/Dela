/** Pi Coding Agent 接线：内核就是 pi-coding-agent SDK；这里只做加载、提供商注册与按 cwd 建会话，工具与会话树仍归 Pi。 */
import { app } from 'electron';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AgentSession, PackageSource, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { StoredLlmProvider } from '../credentials';
import { llmModelSettings, LLM_DEFAULT_CONTEXT_WINDOW } from '../../shared/llm-presets';

type Sdk = typeof import('@earendil-works/pi-coding-agent');

let sdk: Promise<Sdk> | undefined;
/** Pi 包是纯 ESM：主进程 CJS 产物只能动态 import。 */
export function loadPi(): Promise<Sdk> {
  sdk ??= import('@earendil-works/pi-coding-agent');
  return sdk;
}

/** Pi 的全局目录（auth/models/settings/skills/bin）：放在应用数据下，与用户的 ~/.pi 隔离。 */
export function piAgentDir(): string {
  return join(app.getPath('userData'), 'pi');
}

function piSessionsDir(): string {
  return join(piAgentDir(), 'sessions');
}

const PROVIDER = 'dela';

/** Dela 档位 → Pi ThinkingLevel；超出 Pi 档位集的扩展档位挂到最高档。 */
function thinkingLevel(effort: string | undefined) {
  if (!effort || effort === 'none') return 'off' as const;
  const known = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
  return (known as readonly string[]).includes(effort)
    ? (effort as (typeof known)[number])
    : ('max' as const);
}

/** 把当前提供商注册成 Pi 的 OpenAI 兼容提供商。 */
async function resolveModel(provider: StoredLlmProvider, modelId = provider.model) {
  const runtime = await modelRuntime();
  const settings = llmModelSettings(provider, modelId);
  const reasoning = settings.effortLevels.length > 0;
  runtime.registerProvider(PROVIDER, {
    baseUrl: provider.baseUrl.replace(/\/+$/, ''),
    api: 'openai-completions',
    apiKey: provider.apiKey,
    models: provider.models.map((id) => {
      const model = llmModelSettings(provider, id);
      return {
        id,
        name: id,
        reasoning: model.effortLevels.length > 0,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow ?? LLM_DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxOutputTokens ?? 32000,
        // 开推理后 Pi 会把指令消息的 role 写成 OpenAI 专有的 developer，而 Dela 的提供商
        // （DeepSeek/智谱/MiniMax/致远与自定义网关）只认 system，会直接 422 invalid_request_error。
        // Pi 的自动识别靠提供商标识或 baseUrl 里的厂商域名，Dela 把所有提供商都注册成 dela，
        // 识别不出来，只能显式关掉；system 是所有 OpenAI 兼容端点都接受的角色。
        compat: { supportsDeveloperRole: false },
      };
    }),
  });
  const model = runtime.getModel(PROVIDER, modelId) as Model<'openai-completions'> | undefined;
  if (!model) throw new Error('模型不在当前提供商的模型列表中');
  return { model, thinking: reasoning ? thinkingLevel(settings.effort) : ('off' as const) };
}

let runtimePromise: ReturnType<Sdk['ModelRuntime']['create']> | undefined;
async function modelRuntime() {
  const pi = await loadPi();
  runtimePromise ??= pi.ModelRuntime.create({
    authPath: join(piAgentDir(), 'auth.json'),
    modelsPath: join(piAgentDir(), 'models.json'),
  });
  return runtimePromise;
}

/** path 是否在 dir 里面（不含 dir 本身）。 */
export function isInside(path: string, dir: string): boolean {
  const rest = relative(resolve(dir), resolve(path));
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
}

export interface OpenSessionInput {
  cwd: string;
  file?: string;
  provider: StoredLlmProvider;
  /** 追加到 Pi 默认系统提示之后（项目背景、用户自定义指令、dela 命令说明）。 */
  appendSystemPrompt: string[];
  customTools: ToolDefinition[];
  /** 平台 Bash 路径（与终端同源）。 */
  shellPath: string;
  /** bash 每条命令前置的脚本（dela 函数定义）。远程会话不注入。 */
  commandPrefix?: string;
  skillPaths: string[];
  /** 远端会话用：Pi 在本机读不到 AGENTS.md（cwd 是远端路径），由调用方注入远端内容。 */
  agentsFilesOverride?: (base: { agentsFiles: { path: string; content: string }[] }) => {
    agentsFiles: { path: string; content: string }[];
  };
  disabledSkills: ReadonlySet<string>;
  /** 按 SKILL.md 绝对路径停用的 Skill：项目与 Pi package 里的同名 Skill 互不影响。 */
  disabledSkillPaths?: ReadonlySet<string>;
  /**
   * 按名称开关的全局 Skill 目录（内置、本机目录、Pi 自己的 skills 目录、远端镜像）；不在这些目录里
   * 的（项目与包里的）按路径开关。Pi 在 skillsOverride 里还没给 Skill 贴上最终的来源标签，只能按路径分。
   */
  globalSkillDirs: string[];
  /** 按名称停用的 prompt 模板（来自 Pi package）。 */
  disabledPrompts?: ReadonlySet<string>;
  disabledTools: string[];
  /** 已启用的 Pi packages（设置 › 插件 › Packages）；为空时不加载任何包。 */
  packages?: PackageSource[];
  npmCommand?: string[];
}

/**
 * 包里的扩展经 registerMcpServer 注册的服务器，要靠 Pi 的 MCP 扩展去连，工具默认以 codemode 暴露。
 * CLI 自带这三个扩展，SDK 会话不带：只在启用了包时补上，不启用包的会话与之前完全一致。
 * MCP 扩展给空配置、不读任何 mcp.json（Dela 自己的 MCP 由 mcp.ts 管理）；replaceable 让包自带的
 * 同类扩展（别的 MCP 客户端）接管。日志写进 Dela 的 Pi 目录；OAuth 凭据存储 Pi 不导出构造方式，
 * 仍在 Pi 的默认目录，只有需要 OAuth 的 HTTP 服务器会用到。
 */
function packageRuntimeExtensions(pi: Sdk, agentDir: string) {
  return [
    { name: 'codemode', factory: pi.createCodemodeExtension(), replaceable: true },
    { name: 'tool-search', factory: pi.createToolSearchExtension(), replaceable: true },
    {
      name: 'mcp',
      factory: pi.createMcpExtension({
        loadConfig: () => ({ servers: [], errors: [] }),
        logPath: join(agentDir, 'mcp.log'),
      }),
      replaceable: true,
    },
  ];
}

export async function openPiSession(input: OpenSessionInput): Promise<AgentSession> {
  const pi = await loadPi();
  const runtime = await modelRuntime();
  const { model, thinking } = await resolveModel(input.provider);
  const agentDir = piAgentDir();
  const settingsManager = pi.SettingsManager.inMemory({
    shellPath: input.shellPath,
    shellCommandPrefix: input.commandPrefix,
    defaultTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
    ...(input.packages?.length ? { packages: input.packages } : {}),
    ...(input.npmCommand ? { npmCommand: input.npmCommand } : {}),
  });
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: input.cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths: input.skillPaths,
    appendSystemPrompt: input.appendSystemPrompt,
    ...(input.agentsFilesOverride ? { agentsFilesOverride: input.agentsFilesOverride } : {}),
    ...(input.packages?.length
      ? { extensionFactories: packageRuntimeExtensions(pi, agentDir) }
      : {}),
    skillsOverride: (base) => ({
      ...base,
      // 名称名单只管全局 Skill；项目与包里的按路径开关，同名的不受牵连。
      skills: base.skills.filter((skill) => {
        const path = resolve(skill.filePath);
        return input.globalSkillDirs.some((dir) => isInside(path, dir))
          ? !input.disabledSkills.has(skill.name)
          : !input.disabledSkillPaths?.has(path);
      }),
    }),
    promptsOverride: (base) => ({
      ...base,
      prompts: base.prompts.filter((prompt) => !input.disabledPrompts?.has(prompt.name)),
    }),
  });
  await resourceLoader.reload();
  const sessionManager = input.file
    ? pi.SessionManager.open(input.file, piSessionsDir(), input.cwd)
    : pi.SessionManager.create(input.cwd, piSessionsDir());
  const { session } = await pi.createAgentSession({
    cwd: input.cwd,
    agentDir,
    model,
    thinkingLevel: thinking,
    modelRuntime: runtime,
    settingsManager,
    resourceLoader,
    sessionManager,
    customTools: input.customTools,
    excludeTools: input.disabledTools,
  });
  return session;
}

/** 设置页的模型检测：一次无工具的短请求，失败抛出 pi-ai 的错误文案（"<status>: …"）。 */
export async function verifyModel(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoning: boolean;
}): Promise<string> {
  const { completeSimple } = await import('@earendil-works/pi-ai/compat');
  const model: Model<'openai-completions'> = {
    id: input.model,
    name: input.model,
    api: 'openai-completions',
    provider: 'dela-verify',
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    reasoning: input.reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: LLM_DEFAULT_CONTEXT_WINDOW,
    maxTokens: 256,
  };
  const reply = await completeSimple(
    model,
    { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] },
    { apiKey: input.apiKey, maxTokens: 256, signal: AbortSignal.timeout(30000) },
  );
  if (reply.stopReason === 'error') throw new Error(reply.errorMessage ?? '请求失败');
  return reply.content
    .map((block) =>
      block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : '',
    )
    .join('');
}
