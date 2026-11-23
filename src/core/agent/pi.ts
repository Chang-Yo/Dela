/** Pi Coding Agent 接线：内核就是 pi-coding-agent SDK；这里只做加载、提供商注册与按 cwd 建会话，工具与会话树仍归 Pi。 */
import { isAbsolute, join, relative, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type {
  AgentSession,
  FileEntry,
  SessionManager,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { LlmCatalogProvider } from '../protocol/llm';
import type { StoredLlmProvider } from './llm-config';
import {
  llmModelSettings,
  LLM_DEFAULT_CONTEXT_WINDOW,
  LLM_DEFAULT_OUTPUT_TOKENS,
} from '../protocol/llm-models';
import { hostPorts } from '../ports';

type Sdk = typeof import('@earendil-works/pi-coding-agent');

let sdk: Promise<Sdk> | undefined;
/** Pi 包是纯 ESM：主进程 CJS 产物只能动态 import。 */
export function loadPi(): Promise<Sdk> {
  sdk ??= import('@earendil-works/pi-coding-agent');
  return sdk;
}

/** Pi 的全局目录（auth/models/skills 等）放应用数据下，与 ~/.pi 隔离；唯独 bin 只认
 * PI_CODING_AGENT_DIR（Dela 不设），rg/fd 仍在 ~/.pi/agent/bin（Pi 1.1.0，2026-10）。 */
export function piAgentDir(): string {
  return join(hostPorts().paths.userData(), 'pi');
}

function piSessionsDir(): string {
  return join(piAgentDir(), 'sessions');
}

/** 每个 Dela 提供商注册成独立的 Pi 提供商：鉴权按名字查，共用一个名字时各会话的地址与密钥会互相覆盖。 */
const piProviderName = (provider: StoredLlmProvider) => `dela-${provider.id}`;

export interface SessionModel {
  provider: StoredLlmProvider;
  model: string;
  effort: string | null;
}

function thinkingLevel(effort: string | undefined) {
  if (!effort || effort === 'none') return 'off' as const;
  const known = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
  return (known as readonly string[]).includes(effort)
    ? (effort as (typeof known)[number])
    : ('max' as const);
}

type Runtime = Awaited<ReturnType<Sdk['ModelRuntime']['create']>>;

// 需要云账号、订阅登录或 Pi 自家网关，只凭 API Key 接不进来。
const unofferedProviders = new Set(['amazon-bedrock', 'github-copilot', 'radius']);

function offeredProviders(runtime: Runtime) {
  return runtime.getProviders().flatMap((provider) => {
    const models = runtime.getModels(provider.id);
    const offered =
      !unofferedProviders.has(provider.id) &&
      provider.auth.apiKey !== undefined &&
      models.length > 0 &&
      models.every(({ baseUrl }) => baseUrl && !baseUrl.includes('{'));
    return offered ? [{ provider, models }] : [];
  });
}

export async function llmCatalog(): Promise<LlmCatalogProvider[]> {
  const runtime = await modelRuntime();
  void runtime.refresh({ allowNetwork: true }).catch(() => undefined);
  const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai');
  return offeredProviders(runtime).map(({ provider, models }) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl ?? models[0]!.baseUrl,
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      vision: model.input.includes('image'),
      effortLevels: model.reasoning
        ? getSupportedThinkingLevels(model).map((level) => (level === 'off' ? 'none' : level))
        : [],
    })),
  }));
}

function builtinProviderConfig(runtime: Runtime, provider: StoredLlmProvider, piProvider: string) {
  return {
    name: provider.name,
    apiKey: provider.apiKey,
    models: provider.models.flatMap((id) => {
      const model = runtime.getModel(piProvider, id);
      if (!model) return [];
      const { contextWindow, maxOutputTokens } = llmModelSettings(provider, id);
      return [
        {
          ...model,
          contextWindow: contextWindow ?? model.contextWindow,
          maxTokens: maxOutputTokens ?? model.maxTokens,
        },
      ];
    }),
  };
}

function customProviderConfig(provider: StoredLlmProvider) {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl.replace(/\/+$/, ''),
    api: 'openai-completions' as const,
    apiKey: provider.apiKey,
    models: provider.models.map((id) => {
      const model = llmModelSettings(provider, id);
      return {
        id,
        name: id,
        reasoning: model.effortLevels.length > 0,
        input: model.vision ? ['text' as const, 'image' as const] : ['text' as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow ?? LLM_DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxOutputTokens ?? LLM_DEFAULT_OUTPUT_TOKENS,
        // 开推理后 Pi 会把指令写成 OpenAI 专有的 developer 角色，多数兼容服务只认 system。
        compat: { supportsDeveloperRole: false },
      };
    }),
  };
}

/** 注册时 Pi 会重组提供商并刷新快照；配置没变就跳过。 */
const registeredConfigs = new Map<string, string>();

export async function resolveModel({ provider, model: modelId, effort }: SessionModel) {
  const runtime = await modelRuntime();
  const name = piProviderName(provider);
  const config = provider.piProvider
    ? builtinProviderConfig(runtime, provider, provider.piProvider)
    : customProviderConfig(provider);
  const serialized = JSON.stringify(config);
  if (registeredConfigs.get(name) !== serialized) {
    runtime.registerProvider(name, config);
    registeredConfigs.set(name, serialized);
  }
  const model = runtime.getModel(name, modelId);
  if (!model)
    throw new Error(
      provider.piProvider
        ? '模型已不在该厂商的目录中，请在设置中另选模型'
        : '模型不在当前提供商的模型列表中',
    );
  return {
    model,
    thinking: model.reasoning ? thinkingLevel(effort ?? undefined) : ('off' as const),
  };
}

let runtimePromise: Promise<Runtime> | undefined;
async function modelRuntime() {
  const pi = await loadPi();
  runtimePromise ??= pi.ModelRuntime.create({
    authPath: join(piAgentDir(), 'auth.json'),
    modelsPath: join(piAgentDir(), 'models.json'),
    // 不等网络：先用随包目录与上次缓存，pi.dev 的更新在后台拉取（4 小时一次）。
    allowModelNetwork: true,
    refreshOnCreate: false,
  }).then(async (runtime) => {
    await runtime.refresh({ allowNetwork: false });
    void runtime.refresh({ allowNetwork: true }).catch(() => undefined);
    return runtime;
  });
  return runtimePromise;
}

export function isInside(path: string, dir: string): boolean {
  const rest = relative(resolve(dir), resolve(path));
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
}

/** Pi 还会加载项目里的 .pi/skills；Dela 的项目 Skill 只认 .agents/skills。 */
export function isPiProjectSkill(path: string, cwd: string): boolean {
  return isInside(path, join(cwd, '.pi', 'skills'));
}

export interface OpenSessionInput {
  cwd: string;
  file?: string;
  inMemory?: SessionManager;
  parentSession?: string;
  selection: SessionModel;
  appendSystemPrompt: string[];
  customTools: ToolDefinition[];
  shellPath: string;
  commandPrefix?: string;
  skillPaths: string[];
  /** 远端会话用：Pi 在本机读不到 AGENTS.md（cwd 是远端路径），由调用方注入远端内容。 */
  agentsFilesOverride?: (base: { agentsFiles: { path: string; content: string }[] }) => {
    agentsFiles: { path: string; content: string }[];
  };
  disabledSkills: ReadonlySet<string>;
  disabledSkillPaths?: ReadonlySet<string>;
  /** 这些目录里的 Skill 按名称开关，其余按路径；Pi 此时还没贴来源标签。 */
  globalSkillDirs: string[];
  disabledTools: string[];
  /** 每个工具执行前等待它完成，用于先拍完本轮的目录快照再动文件。 */
  beforeTool?: () => Promise<void> | undefined;
}

export async function openPiSession(input: OpenSessionInput): Promise<AgentSession> {
  const pi = await loadPi();
  const runtime = await modelRuntime();
  const { model, thinking } = await resolveModel(input.selection);
  const agentDir = piAgentDir();
  const settingsManager = pi.SettingsManager.inMemory({
    shellPath: input.shellPath,
    shellCommandPrefix: input.commandPrefix,
    defaultTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
  });
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: input.cwd,
    agentDir,
    settingsManager,
    // Pi 是私有引擎：项目里的 .pi/extensions、.pi/prompts 与主题一律不加载。
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    // 内联扩展不受 noExtensions 限制，由 Dela 自己提供。
    extensionFactories: input.beforeTool
      ? [(api) => void api.on('tool_call', async () => void (await input.beforeTool!()))]
      : [],
    additionalSkillPaths: input.skillPaths,
    appendSystemPrompt: input.appendSystemPrompt,
    ...(input.agentsFilesOverride ? { agentsFilesOverride: input.agentsFilesOverride } : {}),
    skillsOverride: (base) => ({
      ...base,
      skills: base.skills.filter((skill) => {
        const path = resolve(skill.filePath);
        if (isPiProjectSkill(path, input.cwd)) return false;
        return input.globalSkillDirs.some((dir) => isInside(path, dir))
          ? !input.disabledSkills.has(skill.name)
          : !input.disabledSkillPaths?.has(path);
      }),
    }),
  });
  await resourceLoader.reload();
  const sessionManager =
    input.inMemory ??
    (input.file
      ? pi.SessionManager.open(input.file, piSessionsDir(), input.cwd)
      : pi.SessionManager.create(
          input.cwd,
          piSessionsDir(),
          input.parentSession ? { parentSession: input.parentSession } : undefined,
        ));
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

export async function forkSessionFile(file: string, cwd: string, entryId: string): Promise<string> {
  const pi = await loadPi();
  const forked = pi.SessionManager.open(file, piSessionsDir(), cwd).createBranchedSession(entryId);
  if (!forked) throw new Error('分支会话没有写出文件');
  return forked;
}

export function writeSessionFile(header: FileEntry & { type: 'session' }, entries: FileEntry[]) {
  const file = join(
    piSessionsDir(),
    `${header.timestamp.replace(/[:.]/g, '-')}_${header.id}.jsonl`,
  );
  writeFileSync(
    file,
    [header, ...entries]
      .map(
        (entry) => `${JSON.stringify(entry)}
`,
      )
      .join(''),
    {
      flag: 'wx',
    },
  );
  return file;
}

export async function verifyModel(input: {
  piProvider: string | null;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoning: boolean;
}): Promise<string> {
  const { completeSimple } = await import('@earendil-works/pi-ai/compat');
  const model: Model<Api> | undefined = input.piProvider
    ? (await modelRuntime()).getModel(input.piProvider, input.model)
    : {
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
  if (!model) throw new Error('模型不在该厂商的目录中');
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
